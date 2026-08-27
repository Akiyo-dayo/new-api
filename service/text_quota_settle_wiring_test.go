package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// billableTextQuota 本身有单测，但「它有没有被接进结算路径」没有。
//
// 这条接线是整个安全网真正生效的那一根线：calculateTextQuotaSummary 里的归零会被
// 阶梯计费在其后覆写（composeTieredTextQuota），而 TryTieredSettle 在表达式求值失败时
// 的兜底是 FinalPreConsumedQuota —— 非零。没有这一行，就会出现
// 「日志记了钱、钱也扣了、used_quota 不加」这种记账与实扣不符的局面。
func TestPostTextConsumeQuotaZeroesChargeWhenUpstreamReturnedNoUsage(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)

	const userID, tokenID, channelID = 88, 88, 88
	require.NoError(t, model.DB.Create(&model.User{
		Id: userID, Username: "settle_wiring_user", Group: "default",
		Quota: 100000, Status: common.UserStatusEnabled,
	}).Error)
	seedToken(t, tokenID, userID, "sk-settle-wiring", 100000)
	seedChannel(t, channelID)

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)

	// 表达式故意写成无法编译的形式，让 TryTieredSettle 走到「求值失败」的兜底分支，
	// 那条分支会返回 FinalPreConsumedQuota（非零）并且 ok=true。
	relayInfo := &relaycommon.RelayInfo{
		UserId: userID, TokenId: tokenID,
		ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
		OriginModelName: "probe-model", UsingGroup: "default",
		FinalPreConsumedQuota: 500,
		TieredBillingSnapshot: &billingexpr.BillingSnapshot{
			BillingMode:              "tiered_expr",
			ModelName:                "probe-model",
			ExprString:               `tier("broken",`,
			ExprHash:                 "deadbeef",
			GroupRatio:               1,
			QuotaPerUnit:             common.QuotaPerUnit,
			EstimatedQuotaAfterGroup: 500,
		},
	}

	// usage 非 nil（所以阶梯分支会跑），但一个 token 都没有 —— 上游超时的典型形态。
	PostTextConsumeQuota(ctx, relayInfo, &dto.Usage{}, nil)

	var logged model.Log
	require.NoError(t, model.DB.Where("token_id = ?", tokenID).Order("id desc").First(&logged).Error)
	assert.Equal(t, 0, logged.Quota,
		"上游没有返回可计费用量时，消费日志记的金额必须是 0")

	var user model.User
	require.NoError(t, model.DB.First(&user, userID).Error)
	// 注意：这条是陪衬不是防线 —— !hasBillableUsage() 分支本来就跳过
	// UpdateUserUsedQuotaAndRequestCount，接线在不在它都成立。真正的防线是上面那条日志断言。
	assert.Zero(t, user.UsedQuota, "used_quota 不应因为一次没有可计费用量的请求而增加")
}
