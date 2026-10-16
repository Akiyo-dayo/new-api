package service

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// installSkipRetryAffinityRule 装一条 SkipRetryOnFailure 的规则（形状照生产默认的
// codex cli trace），并返回它对某个亲和值算出的缓存键。
//
// 唯一键用 t.Name() 而不是 time.Now()：Windows 上时钟精度只到毫秒级，连着跑的用例会
// 取到同一个"纳秒"值而共用缓存条目。
func installSkipRetryAffinityRule(t *testing.T, affinityValue string) string {
	t.Helper()
	rule := operation_setting.ChannelAffinityRule{
		Name:               "skip-retry-probe",
		ModelRegex:         []string{"^gpt-.*$"},
		PathRegex:          []string{"/v1/responses"},
		KeySources:         []operation_setting.ChannelAffinityKeySource{{Type: "request_header", Key: "X-Affinity-Key"}},
		SkipRetryOnFailure: true,
		IncludeRuleName:    true,
		IncludeModelName:   true,
	}
	setting := operation_setting.GetChannelAffinitySetting()
	originalRules := setting.Rules
	setting.Rules = append([]operation_setting.ChannelAffinityRule{rule}, originalRules...)
	t.Cleanup(func() { setting.Rules = originalRules })

	return buildChannelAffinityCacheKeySuffix(rule, "gpt-5", "default", affinityValue)
}

func newAffinityRequestContext(affinityValue string) *gin.Context {
	rec := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(rec)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/responses", nil)
	ctx.Request.Header.Set("X-Affinity-Key", affinityValue)
	return ctx
}

// 亲和缓存未命中时不能跳过重试。
//
// 这是**每个新会话的第一次请求**都会走的路径：GetPreferredChannelByAffinity 为了让
// RecordChannelAffinity 事后能把新会话种进缓存，必须在查缓存之前就把含
// SkipRetry 的 meta 写进 context；而 miss 时 distributor 的亲和分支整块不进，
// MarkChannelAffinityUsed 与 ClearCurrentChannelAffinityCache 都不会跑。
// 判据一旦回落到那份 meta，「规则匹配上了」就等于「整条请求不重试」——
// 倍率区间令牌的「便宜价位失败后降级到下一个价位」在 gpt-* / claude-* 上就此失效。
func TestSkipRetryNotArmedWhenAffinityCacheMisses(t *testing.T) {
	gin.SetMode(gin.TestMode)

	affinityValue := t.Name()
	cacheKeySuffix := installSkipRetryAffinityRule(t, affinityValue)
	cache := getChannelAffinityCache()
	_, _ = cache.DeleteMany([]string{cacheKeySuffix})

	ctx := newAffinityRequestContext(affinityValue)
	channelID, found := GetPreferredChannelByAffinity(ctx, "gpt-5", "default")
	require.False(t, found, "本用例的前提是缓存未命中")
	require.Zero(t, channelID)

	meta, ok := getChannelAffinityMeta(ctx)
	require.True(t, ok, "meta 确实被提前写进去了——正是它诱发了原来的回落")
	require.True(t, meta.SkipRetry, "规则的 SkipRetryOnFailure 是 true，否则这条用例什么都没测到")

	assert.False(t, ShouldSkipRetryAfterChannelAffinityFailure(ctx),
		"亲和没用上就不能关掉重试")
}

// 反证：同一条规则、同一个上下文，缓存命中且亲和真的被采用时必须跳过重试。
// 没有这一条，上面那条 false 可以靠一个恒返回 false 的实现通过。
func TestSkipRetryArmedWhenAffinityIsActuallyUsed(t *testing.T) {
	gin.SetMode(gin.TestMode)

	affinityValue := t.Name()
	cacheKeySuffix := installSkipRetryAffinityRule(t, affinityValue)
	cache := getChannelAffinityCache()
	require.NoError(t, cache.SetWithTTL(cacheKeySuffix, 9531, time.Minute))
	t.Cleanup(func() { _, _ = cache.DeleteMany([]string{cacheKeySuffix}) })

	ctx := newAffinityRequestContext(affinityValue)
	channelID, found := GetPreferredChannelByAffinity(ctx, "gpt-5", "default")
	require.True(t, found)
	require.Equal(t, 9531, channelID)

	// distributor 采用亲和时紧跟着就是这一句。
	MarkChannelAffinityUsed(ctx, "default", channelID)

	assert.True(t, ShouldSkipRetryAfterChannelAffinityFailure(ctx),
		"亲和真的钉住了渠道，那个渠道挂了就不该再换渠道重试")
}
