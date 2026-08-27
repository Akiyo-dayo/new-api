package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 结算失败时，SettleBilling 必须返回**用户身上实际落下的额度**而不是应扣额度。
//
// 预扣费在请求开始时已经扣走；结算是事后补/退差额那一步。它失败时差额没动，
// 用户被扣的就只有预扣额。日志和 used_quota 如果还按应扣额记，账面与实扣就对不上，
// 而这只发生在数据库故障期间——最不希望账乱、事后又最难复盘的时刻。
func TestSettleBillingReturnsPreConsumedWhenSettleFails(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	// users 表不存在 -> 旧路径的 DecreaseUserQuota 必然失败
	require.NoError(t, model.DB.Migrator().DropTable(&model.User{}))
	t.Cleanup(func() { require.NoError(t, model.DB.AutoMigrate(&model.User{})) })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId: 4101, TokenId: 4101, OriginModelName: "probe-model",
		FinalPreConsumedQuota: 300,
	}

	charged, err := SettleBilling(ctx, relayInfo, 500)

	require.Error(t, err)
	assert.Equal(t, 300, charged, "结算失败时用户身上只剩预扣额，记账必须按这个数")
	require.NotNil(t, relayInfo.SettleFailure, "失败必须留痕，否则事后无法把受影响的请求捞出来")
	assert.Equal(t, 500, relayInfo.SettleFailure.ActualQuota)
	assert.Equal(t, 300, relayInfo.SettleFailure.ChargedQuota)
	assert.NotEmpty(t, relayInfo.SettleFailure.Reason)
}

// 结算成功时返回应扣额，且不留失败痕迹——防止上面那条把正常路径也标成失败。
func TestSettleBillingReturnsActualQuotaOnSuccess(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 4102, 100000)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId: 4102, TokenId: 4102, OriginModelName: "probe-model",
		FinalPreConsumedQuota: 300,
	}

	charged, err := SettleBilling(ctx, relayInfo, 500)

	require.NoError(t, err)
	assert.Equal(t, 500, charged)
	assert.Nil(t, relayInfo.SettleFailure)
}

// 失败痕迹要落进消费日志的 admin_info（非管理员视图会整块剥掉，所以天然只对管理员可见）。
func TestAttachSettleFailureWritesAdminInfoMarker(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	relayInfo := &relaycommon.RelayInfo{
		UserId: 4103, OriginModelName: "probe-model",
		SettleFailure: &relaycommon.SettleFailure{
			ActualQuota: 500, ChargedQuota: 300, Reason: "db down",
		},
	}
	other := map[string]interface{}{}

	attachSettleFailure(ctx, relayInfo, other)

	adminInfo, ok := other["admin_info"].(map[string]interface{})
	require.True(t, ok)
	marker, ok := adminInfo["settle_failed"].(map[string]interface{})
	require.True(t, ok)
	assert.Equal(t, 500, marker["actual_quota"])
	assert.Equal(t, 300, marker["charged_quota"])
	assert.Equal(t, "db down", marker["reason"])
}

// 反证：没失败时不能凭空加标记，否则日志里全是噪音、真出事时反而看不出来。
func TestAttachSettleFailureNoopWhenSettlementSucceeded(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	other := map[string]interface{}{}

	attachSettleFailure(ctx, &relaycommon.RelayInfo{UserId: 4104}, other)

	assert.Empty(t, other)
}

// 接线：消费日志记的必须是**实扣额**，并且带上失败标记。
//
// 这条测的是「SettleBilling 的返回值真的被用在了记账上」——单测返回值对不代表接线对，
// 本项目在接线上栽过多次。
func TestPostTextConsumeQuotaLogsChargedQuotaWhenSettleFails(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	const userID, tokenID, channelID = 4105, 4105, 4105
	seedUser(t, userID, 100000)
	seedToken(t, tokenID, userID, "sk-settle-failure", 100000)
	seedChannel(t, channelID)
	require.NoError(t, model.DB.Migrator().DropTable(&model.User{}))
	t.Cleanup(func() { require.NoError(t, model.DB.AutoMigrate(&model.User{})) })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		OriginModelName: "probe-model", UsingGroup: "default",
		FinalPreConsumedQuota: 300,
	}

	PostTextConsumeQuota(ctx, relayInfo, &dto.Usage{PromptTokens: 10, CompletionTokens: 10, TotalTokens: 20}, nil)

	var logged model.Log
	require.NoError(t, model.DB.Where("token_id = ?", tokenID).Order("id desc").First(&logged).Error)
	assert.Equal(t, 300, logged.Quota,
		"结算失败时日志必须记实扣额（预扣 300），记应扣额就与用户余额对不上账")

	var other map[string]interface{}
	require.NoError(t, common.UnmarshalJsonStr(logged.Other, &other))
	adminInfo, ok := other["admin_info"].(map[string]interface{})
	require.True(t, ok)
	assert.Contains(t, adminInfo, "settle_failed", "失败必须在日志里留痕")
}

// ChargedQuota 的判据必须是「资金那一步提交了没有」，不是「整个结算完成了没有」。
//
// **这条用例保护的状态今天不可达**：Settle 只被调用一次，令牌调整失败时代码仍会置
// settled=true，于是 settled 与 fundingSettled 恒同真同假，把判据写成 s.settled 也看不
// 出区别（对它做变异会存活）。所以这里直接构造那个中间态，而不是走正常路径。
//
// 留着它是因为「资金已提交、结算未完成」是语义上真实存在的一步：Settle 分两阶段提交，
// 一旦将来它变成可重试（重试时 fundingSettled=true 而 settled=false），判错就会把已经
// 扣走的钱按预扣额记账。**什么时候可以删掉这条**：如果将来把两阶段合并成单次原子提交、
// fundingSettled 这个字段本身消失，那它就没有存在意义了。
func TestBillingSessionChargedQuotaFollowsFundingCommit(t *testing.T) {
	settledFunding := &BillingSession{preConsumedQuota: 300, fundingSettled: true}
	assert.Equal(t, 500, settledFunding.ChargedQuota(500),
		"资金已提交 = 用户身上落下的是应扣额")

	uncommitted := &BillingSession{preConsumedQuota: 300}
	assert.Equal(t, 300, uncommitted.ChargedQuota(500),
		"资金没提交 = 用户身上只剩预扣额")
}

// 上游没返回可计费用量、同时结算又失败时，钱仍然落在用户身上（只剩预扣额），
// 所以 used_quota / 渠道用量必须跟着记 —— 否则日志上有金额、统计里没有，
// 又回到这轮要消除的那种分歧。
//
// 用渠道用量断言而不是 used_quota：这条用例靠 drop users 表来制造结算失败，
// 那张表没了 used_quota 本来也写不进去，断言它等于什么都没测到。
func TestPostTextConsumeQuotaCountsUsageWhenSettleFailedWithoutUpstreamUsage(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	const userID, tokenID, channelID = 4106, 4106, 4106
	seedUser(t, userID, 100000)
	seedToken(t, tokenID, userID, "sk-settle-nousage", 100000)
	seedChannel(t, channelID)
	require.NoError(t, model.DB.Migrator().DropTable(&model.User{}))
	t.Cleanup(func() { require.NoError(t, model.DB.AutoMigrate(&model.User{})) })

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		OriginModelName: "probe-model", UsingGroup: "default",
		FinalPreConsumedQuota: 300,
	}

	// usage 非 nil 但一个 token 都没有：上游超时的典型形态
	PostTextConsumeQuota(ctx, relayInfo, &dto.Usage{}, nil)

	var logged model.Log
	require.NoError(t, model.DB.Where("token_id = ?", tokenID).Order("id desc").First(&logged).Error)
	require.Equal(t, 300, logged.Quota, "日志记的是实扣额")

	var channel model.Channel
	require.NoError(t, model.DB.First(&channel, channelID).Error)
	assert.EqualValues(t, 300, channel.UsedQuota,
		"钱扣了就要记账，不能因为上游没返回用量就把这笔漏掉")
}

// 反证：上游超时且结算成功时，这次请求既没扣到钱、也不该计进请求数。
// 少了这条，把守卫放宽成"永远记账"就没人拦得住——那会让每一次上游超时都被算作一次用量。
func TestPostTextConsumeQuotaSkipsAccountingWhenNothingWasCharged(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	const userID, tokenID, channelID = 4107, 4107, 4107
	seedUser(t, userID, 100000)
	seedToken(t, tokenID, userID, "sk-settle-nocharge", 100000)
	seedChannel(t, channelID)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		OriginModelName: "probe-model", UsingGroup: "default",
	}

	PostTextConsumeQuota(ctx, relayInfo, &dto.Usage{}, nil)

	var user model.User
	require.NoError(t, model.DB.First(&user, userID).Error)
	assert.Zero(t, user.RequestCount, "上游超时不计请求数")
	assert.Zero(t, user.UsedQuota)

	var channel model.Channel
	require.NoError(t, model.DB.First(&channel, channelID).Error)
	assert.Zero(t, channel.UsedQuota)
}
