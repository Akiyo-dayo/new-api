package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 这一组用例守的是整条计费链上唯一真正重要的那条不变式：
//
//	消费日志记的金额 == 用户余额少的 == used_quota 多的 == 渠道用量多的 == 令牌额度少的
//
// 单条修复各有各的用例，但它们都只盯住链条的一段。少收、多收、以及「记账与实扣不符」
// 这三件事在这里是同一个断言：四本账里任意两本对不上就红。
//
// 覆盖的是生产真正在跑的路径（钱包资金来源 + 按量/按次计费）。订阅计费在这套部署里
// 没有任何用户使用，未纳入。
func TestBillingIsConservedAcrossAllLedgers(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const initialUserQuota = 1_000_000
	const initialTokenQuota = 1_000_000

	cases := []struct {
		name         string
		preConsume   int
		usage        *dto.Usage
		price        types.PriceData
		tiered       *billingexpr.BillingSnapshot
		wantCharged  int
		wantRequests int
	}{
		{
			name:       "实扣大于预扣（补扣）",
			preConsume: 100,
			usage:      &dto.Usage{PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			wantCharged: 300, wantRequests: 1,
		},
		{
			name:       "实扣小于预扣（退还）",
			preConsume: 5000,
			usage:      &dto.Usage{PromptTokens: 10, CompletionTokens: 10, TotalTokens: 20},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			wantCharged: 40, wantRequests: 1,
		},
		{
			name:       "实扣等于预扣",
			preConsume: 300,
			usage:      &dto.Usage{PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			wantCharged: 300, wantRequests: 1,
		},
		{
			name:       "分组倍率为 0 的免费分组",
			preConsume: 0,
			usage:      &dto.Usage{PromptTokens: 1000, CompletionTokens: 500, TotalTokens: 1500},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 0}},
			wantCharged: 0, wantRequests: 1,
		},
		{
			name:       "上游没有返回可计费用量（预扣必须全退）",
			preConsume: 800,
			usage:      &dto.Usage{},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			wantCharged: 0, wantRequests: 0,
		},
		{
			name:       "按次计费",
			preConsume: 250,
			usage:      &dto.Usage{PromptTokens: 7, CompletionTokens: 3, TotalTokens: 10},
			price: types.PriceData{UsePrice: true, ModelPrice: 0.001,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			wantCharged: int(0.001 * common.QuotaPerUnit), wantRequests: 1,
		},
		{
			// 阶梯计费是生产上 DeepSeek / Claude 这批模型真正走的路径，
			// 也是「日志记了钱、钱扣了、used_quota 不加」那条 bug 的发源地。
			name: "阶梯计费正常结算",
			// 预扣额刻意取成和结算额不同的数：两者相等时，「结算额被误当成预扣额」
			// 这类变异会变成等价变异，用例看着绿其实什么都没守住。
			preConsume: 333,
			usage:      &dto.Usage{PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			tiered: &billingexpr.BillingSnapshot{
				BillingMode: "tiered_expr", ModelName: "conserve-model",
				ExprString: `tier("base", p * 2)`, ExprHash: "ok01",
				GroupRatio: 1, QuotaPerUnit: common.QuotaPerUnit,
				EstimatedQuotaAfterGroup: 100,
			},
			// tier 的第二个参数是每百万 token 的价格：(p*2) * QuotaPerUnit/1e6
			// = (100*2) * 0.5 = 100。
			wantCharged: 100, wantRequests: 1,
		},
		{
			// 表达式求值失败时兜底成预扣额：这笔钱照收，四本账仍然必须齐。
			name:       "阶梯计费求值失败走兜底",
			preConsume: 640,
			usage:      &dto.Usage{PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			tiered: &billingexpr.BillingSnapshot{
				BillingMode: "tiered_expr", ModelName: "conserve-model",
				ExprString: `tier("broken",`, ExprHash: "bad01",
				GroupRatio: 1, QuotaPerUnit: common.QuotaPerUnit,
				EstimatedQuotaAfterGroup: 640,
			},
			wantCharged: 640, wantRequests: 1,
		},
		{
			name:       "补扣把余额打成负数（余额允许为负）",
			preConsume: 10,
			usage:      &dto.Usage{PromptTokens: 900_000, CompletionTokens: 200_000, TotalTokens: 1_100_000},
			price: types.PriceData{ModelRatio: 2, CompletionRatio: 1,
				GroupRatioInfo: types.GroupRatioInfo{GroupRatio: 1}},
			wantCharged: 2_200_000, wantRequests: 1,
		},
	}

	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			truncate(t)
			userID, tokenID, channelID := 900+i, 900+i, 900+i
			require.NoError(t, model.DB.Create(&model.User{
				Id: userID, Username: fmt.Sprintf("conserve_%d", i), Group: "default",
				Quota: initialUserQuota, Status: common.UserStatusEnabled,
			}).Error)
			key := fmt.Sprintf("sk-conserve-%d", i)
			seedToken(t, tokenID, userID, key, initialTokenQuota)
			seedChannel(t, channelID)

			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			ctx.Request = httptest.NewRequest("POST", "/v1/chat/completions", nil)
			ctx.Set("token_quota", initialTokenQuota)

			relayInfo := &relaycommon.RelayInfo{
				UserId: userID, TokenId: tokenID, TokenKey: key,
				ChannelMeta:     &relaycommon.ChannelMeta{ChannelId: channelID},
				OriginModelName: "conserve-model", UsingGroup: "default",
				PriceData:             tc.price,
				TieredBillingSnapshot: tc.tiered,
			}

			// 走真实的预扣入口，而不是直接摆 FinalPreConsumedQuota：
			// 预扣本身就是四本账里两本的第一次变动，绕过它这条不变式就测不到了。
			require.Nil(t, PreConsumeBilling(ctx, tc.preConsume, relayInfo))
			PostTextConsumeQuota(ctx, relayInfo, tc.usage, nil)

			var logged model.Log
			require.NoError(t, model.DB.Where("token_id = ?", tokenID).Order("id desc").First(&logged).Error)
			var user model.User
			require.NoError(t, model.DB.First(&user, userID).Error)
			var token model.Token
			require.NoError(t, model.DB.First(&token, tokenID).Error)
			var channel model.Channel
			require.NoError(t, model.DB.First(&channel, channelID).Error)

			charged := logged.Quota
			assert.Equal(t, tc.wantCharged, charged, "计费金额本身")

			// 四本账互相对齐 —— 这才是这条用例存在的理由
			assert.EqualValues(t, charged, initialUserQuota-user.Quota, "余额减少量必须等于日志金额")
			assert.EqualValues(t, charged, user.UsedQuota, "used_quota 必须等于日志金额")
			assert.EqualValues(t, charged, channel.UsedQuota, "渠道用量必须等于日志金额")
			assert.EqualValues(t, charged, initialTokenQuota-token.RemainQuota, "令牌额度减少量必须等于日志金额")
			assert.EqualValues(t, tc.wantRequests, user.RequestCount, "请求数")
		})
	}
}
