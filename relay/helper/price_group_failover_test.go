package helper

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

// auto 令牌与倍率区间令牌在一次请求内可能跨分组降级：最便宜那层的上游挂了，
// controller/relay.go 的重试循环会重新选路到更贵的分组，并调用 HandleGroupRatio
// 刷新分组倍率。但 tiered_expr 的结算读的是 info.TieredBillingSnapshot.GroupRatio，
// 两者不同步时，日志记的是新分组倍率、实际扣的是旧分组倍率（少收或多收）。
func TestTieredSnapshotGroupRatioFollowsCrossGroupFailover(t *testing.T) {
	gin.SetMode(gin.TestMode)

	saved := map[string]string{}
	require.NoError(t, config.GlobalConfig.SaveToDB(func(key, value string) error {
		saved[key] = value
		return nil
	}))
	originalGroupRatio := ratio_setting.GroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(saved))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalGroupRatio))
	})

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"billing_setting.billing_mode": `{"probe-model":"tiered_expr"}`,
		"billing_setting.billing_expr": `{"probe-model":"tier(\"flat\", p * 2)"}`,
	}))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"cheap":0.15,"pricey":0.25}`))

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Body = nil
	req.ContentLength = 0
	req.Header.Set("Content-Type", "application/json")
	ctx.Request = req

	info := &relaycommon.RelayInfo{
		OriginModelName: "probe-model",
		UserGroup:       "default",
		UsingGroup:      "ratio:0.15-0.25",
		RequestHeaders:  map[string]string{"Content-Type": "application/json"},
		BillingRequestInput: &billingexpr.RequestInput{
			Headers: map[string]string{"Content-Type": "application/json"},
			Body:    []byte(`{}`),
		},
	}

	// 分发器选中了最便宜的分组
	ctx.Set("auto_group", "cheap")
	_, err := ModelPriceHelper(ctx, info, 1000, &types.TokenCountMeta{})
	require.NoError(t, err)
	require.NotNil(t, info.TieredBillingSnapshot)
	require.Equal(t, 0.15, info.TieredBillingSnapshot.GroupRatio, "冻结的应当是分发器选中的那个分组")

	// cheap 那层上游失败，重试降级到 pricey —— 这两行就是 controller/relay.go:getChannel 做的事
	ctx.Set("auto_group", "pricey")
	info.PriceData.GroupRatioInfo = HandleGroupRatio(ctx, info)

	require.Equal(t, 0.25, info.PriceData.GroupRatioInfo.GroupRatio, "日志与非阶梯计费用的是这个值")
	require.Equal(t, info.PriceData.GroupRatioInfo.GroupRatio, info.TieredBillingSnapshot.GroupRatio,
		"阶梯计费结算读 snapshot.GroupRatio，与实际计费分组不一致就会按旧倍率扣费")

	// 结算金额本身也要按降级后的分组算：p*2 → 1000 tokens 记 2000 单位价，
	// quotaBeforeGroup = 2000/1e6*QuotaPerUnit，再乘 0.25。
	settled, err := billingexpr.ComputeTieredQuota(info.TieredBillingSnapshot, billingexpr.TokenParams{P: 1000})
	require.NoError(t, err)
	expected := common.QuotaRound(2000.0 / 1_000_000 * common.QuotaPerUnit * 0.25)
	require.Equal(t, expected, settled.ActualQuotaAfterGroup, "降级后必须按 pricey 的倍率结算")
}
