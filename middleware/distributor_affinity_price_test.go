package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// useProbeAffinityRule 把线上那两条默认规则（Codex CLI / Claude CLI）的关键形状搬到
// 测试模型上：SwitchOnSuccess 记的是**实际成功的那个渠道**，正是它会把降级用的贵渠道
// 写进亲和缓存。TTL 给足，保证两次请求之间不会靠过期自愈。
func useProbeAffinityRule(t *testing.T) {
	t.Helper()
	affinity := operation_setting.GetChannelAffinitySetting()
	previous := *affinity
	t.Cleanup(func() { *affinity = previous })
	*affinity = operation_setting.ChannelAffinitySetting{
		Enabled:           true,
		SwitchOnSuccess:   true,
		MaxEntries:        16,
		DefaultTTLSeconds: 3600,
		Rules: []operation_setting.ChannelAffinityRule{{
			Name:       "probe affinity",
			ModelRegex: []string{"^probe-model$"},
			KeySources: []operation_setting.ChannelAffinityKeySource{
				{Type: "request_header", Key: "X-Probe-Session"},
			},
			TTLSeconds:        3600,
			IncludeUsingGroup: true,
			IncludeRuleName:   true,
		}},
	}
}

// runDistributeWithAffinity 跑一次带亲和键的请求，sessionKey 相同就落在同一个亲和缓存槽上。
func runDistributeWithAffinity(t *testing.T, tokenGroup, sessionKey string) *gin.Context {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		strings.NewReader(`{"model":"probe-model"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	ctx.Request.Header.Set("X-Probe-Session", sessionKey)
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, tokenGroup)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "tester")

	Distribute()(ctx)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	return ctx
}

// setChannelStatus 模拟 auto-ban / 恢复：渠道内存缓存只收录 Enabled 的渠道，
// 重建后 GetRandomSatisfiedChannel 就看不到（或重新看到）它了。
func setChannelStatus(t *testing.T, channelID, status int) {
	t.Helper()
	require.NoError(t, model.DB.Model(&model.Channel{}).
		Where("id = ?", channelID).Update("status", status).Error)
	model.InitChannelCache()
}

// B4：便宜层被 auto-ban 期间请求降级到贵渠道并成功，亲和把那个贵渠道记了下来；
// 便宜层恢复后亲和整段跳过 selectRatioRangeChannel 的价位分层，于是接下来一整个 TTL
// （默认 3600 秒）里同一个会话都按 0.3 而不是 0.1 计费 —— 多扣 3 倍。
func TestDistributeAffinityGivesUpWhenCheapTierRecovers(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{
			{Id: 9701, Group: "cheap", Models: "probe-model", Name: "cheap-ch"},
			{Id: 9702, Group: "pricey", Models: "probe-model", Name: "pricey-ch"},
		},
		`{"cheap":0.1,"pricey":0.3}`,
		`{"cheap":"","pricey":""}`)
	useProbeAffinityRule(t)

	setChannelStatus(t, 9701, common.ChannelStatusAutoDisabled)
	banned := runDistributeWithAffinity(t, "ratio:0.1-0.3", "b4-session")
	require.Equal(t, "pricey", common.GetContextKeyString(banned, constant.ContextKeyAutoGroup),
		"cheap 被 ban，只能降级到 pricey —— 这一步把贵渠道写进了亲和缓存")
	require.Equal(t, 9702, common.GetContextKeyInt(banned, constant.ContextKeyChannelId))

	setChannelStatus(t, 9701, common.ChannelStatusEnabled)
	recovered := runDistributeWithAffinity(t, "ratio:0.1-0.3", "b4-session")

	assert.Equal(t, "cheap", common.GetContextKeyString(recovered, constant.ContextKeyAutoGroup),
		"cheap 恢复后必须放弃亲和，按 0.1 计费而不是继续钉在 0.3 上")
	assert.Equal(t, 9701, common.GetContextKeyInt(recovered, constant.ContextKeyChannelId))
}

// 同价位的另一个分组恢复不构成降价理由：倍率相等要保留亲和，
// 否则每次请求都被同价轮询踢走，会话粘性没了而用户一分钱也没省。
func TestDistributeAffinityKeptWhenRecoveredTierCostsTheSame(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{
			{Id: 9711, Group: "cheap-a", Models: "probe-model", Name: "cheap-a-ch"},
			{Id: 9712, Group: "cheap-b", Models: "probe-model", Name: "cheap-b-ch"},
		},
		`{"cheap-a":0.1,"cheap-b":0.1}`,
		`{"cheap-a":"","cheap-b":""}`)
	useProbeAffinityRule(t)

	setChannelStatus(t, 9711, common.ChannelStatusAutoDisabled)
	pinned := runDistributeWithAffinity(t, "ratio:0.1-0.3", "equal-session")
	require.Equal(t, "cheap-b", common.GetContextKeyString(pinned, constant.ContextKeyAutoGroup))
	require.Equal(t, 9712, common.GetContextKeyInt(pinned, constant.ContextKeyChannelId))

	setChannelStatus(t, 9711, common.ChannelStatusEnabled)
	after := runDistributeWithAffinity(t, "ratio:0.1-0.3", "equal-session")

	assert.Equal(t, "cheap-b", common.GetContextKeyString(after, constant.ContextKeyAutoGroup),
		"cheap-a 与 cheap-b 同为 0.1，亲和必须留在 cheap-b")
	assert.Equal(t, 9712, common.GetContextKeyInt(after, constant.ContextKeyChannelId))
}

// auto 的语义是**按 auto_groups 的配置顺序回退**而不是最低价优先，比价不能套到它头上。
//
// 这里把上一个用例的局面原样搬到 auto 上：cheap 被 ban 期间降级到 pricey 并写进亲和，
// cheap 恢复后 auto 的正常选路会取配置里排第一的 cheap —— 所以「仍然是 pricey」既证明
// 亲和确实命中了，也证明比价没有误伤 auto 的既有行为。
func TestDistributeAffinityKeptForAutoTokenRegardlessOfPrice(t *testing.T) {
	previousAuto := setting.AutoGroups2JsonString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateAutoGroupsByJsonString(previousAuto)) })
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["cheap","pricey"]`))
	setupDistributorTest(t,
		[]model.Channel{
			{Id: 9721, Group: "cheap", Models: "probe-model", Name: "cheap-ch"},
			{Id: 9722, Group: "pricey", Models: "probe-model", Name: "pricey-ch"},
		},
		`{"cheap":0.1,"pricey":0.3}`,
		`{"cheap":"","pricey":""}`)
	useProbeAffinityRule(t)

	setChannelStatus(t, 9721, common.ChannelStatusAutoDisabled)
	banned := runDistributeWithAffinity(t, "auto", "auto-session")
	require.Equal(t, "pricey", common.GetContextKeyString(banned, constant.ContextKeyAutoGroup))
	require.Equal(t, 9722, common.GetContextKeyInt(banned, constant.ContextKeyChannelId))

	setChannelStatus(t, 9721, common.ChannelStatusEnabled)
	recovered := runDistributeWithAffinity(t, "auto", "auto-session")

	assert.Equal(t, "pricey", common.GetContextKeyString(recovered, constant.ContextKeyAutoGroup),
		"auto 令牌的亲和不受比价影响；改判成 cheap 就是把 auto 的顺序回退语义改成了价格优先")
	assert.Equal(t, 9722, common.GetContextKeyInt(recovered, constant.ContextKeyChannelId))
}
