package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withRateLimitSettings(t *testing.T, enabled bool, minutes, total, success int, groupJSON string) {
	t.Helper()

	prevEnabled := setting.ModelRequestRateLimitEnabled
	prevMinutes := setting.ModelRequestRateLimitDurationMinutes
	prevTotal := setting.ModelRequestRateLimitCount
	prevSuccess := setting.ModelRequestRateLimitSuccessCount
	prevGroup := setting.ModelRequestRateLimitGroup2JSONString()
	t.Cleanup(func() {
		setting.ModelRequestRateLimitEnabled = prevEnabled
		setting.ModelRequestRateLimitDurationMinutes = prevMinutes
		setting.ModelRequestRateLimitCount = prevTotal
		setting.ModelRequestRateLimitSuccessCount = prevSuccess
		require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(prevGroup))
	})

	setting.ModelRequestRateLimitEnabled = enabled
	setting.ModelRequestRateLimitDurationMinutes = minutes
	setting.ModelRequestRateLimitCount = total
	setting.ModelRequestRateLimitSuccessCount = success
	require.NoError(t, setting.UpdateModelRequestRateLimitGroupByJSONString(groupJSON))
}

// 分组有覆盖用覆盖、没有用全局——这条回退必须和 middleware/model-rate-limit.go 一致，
// 否则页面上写的数和真正拦请求的数是两回事。
func TestResolveRateLimitDisplayAppliesGroupOverride(t *testing.T) {
	withRateLimitSettings(t, true, 5, 100, 60, `{"vip":[500,300]}`)

	display := ResolveRateLimitDisplay(map[string]string{"vip": "", "plain": ""})

	require.Equal(t, []GroupRateLimit{
		{Group: "plain", TotalCount: 100, SuccessCount: 60, Overridden: false},
		{Group: "vip", TotalCount: 500, SuccessCount: 300, Overridden: true},
	}, display.Groups)
	assert.True(t, display.Enabled)
	assert.Equal(t, 5, display.DurationMinutes)
}

// 限流没开的时候不能列表：列出来等于对外承诺一组根本不生效的限制。
func TestResolveRateLimitDisplayReportsDisabledWithoutGroups(t *testing.T) {
	withRateLimitSettings(t, false, 1, 100, 60, `{"vip":[500,300]}`)

	display := ResolveRateLimitDisplay(map[string]string{"vip": ""})

	assert.False(t, display.Enabled)
	assert.Empty(t, display.Groups)
}

// 只吐调用方可见的分组，否则等于把别人的分组名泄露给所有访客。
func TestResolveRateLimitDisplayOnlyReturnsVisibleGroups(t *testing.T) {
	withRateLimitSettings(t, true, 1, 100, 60, `{"secret":[9,9],"vip":[500,300]}`)

	display := ResolveRateLimitDisplay(map[string]string{"vip": ""})

	require.Len(t, display.Groups, 1)
	assert.Equal(t, "vip", display.Groups[0].Group)
}

// 顺序必须确定，否则每次刷新页面表格行都在跳。
func TestResolveRateLimitDisplaySortsGroupsByName(t *testing.T) {
	withRateLimitSettings(t, true, 1, 100, 60, `{}`)

	display := ResolveRateLimitDisplay(map[string]string{"c": "", "a": "", "b": ""})

	require.Len(t, display.Groups, 3)
	assert.Equal(t, []string{"a", "b", "c"},
		[]string{display.Groups[0].Group, display.Groups[1].Group, display.Groups[2].Group})
}
