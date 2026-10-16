package service

import (
	"sort"

	"github.com/QuantumNous/new-api/setting"
)

// GroupRateLimit 是某个分组**实际生效**的限流额度。
//
// 已经把「分组有覆盖就用覆盖、没有就用全局」这条回退算完了，前端不必再实现一遍
// —— 那正是 middleware/model-rate-limit.go 里的判断，同一个判据有两份实现迟早对不上。
type GroupRateLimit struct {
	Group string `json:"group"`
	// TotalCount 是窗口内的总请求数上限，0 表示不限。
	TotalCount int `json:"total_count"`
	// SuccessCount 是窗口内的成功请求数上限。
	SuccessCount int `json:"success_count"`
	// Overridden 表示这一档来自分组级配置而不是全局默认值。
	Overridden bool `json:"overridden"`
}

// RateLimitDisplay 是模型广场要展示的限流信息。
//
// 站点真实的限流模型是「N 分钟窗口内的总请求数 / 成功请求数」，**没有 RPM/TPM/RPD 这三个量**
// ——前端原来那张表连形状都是编的（见 pricing/lib/mock-stats.ts 的 buildRateLimits）。
type RateLimitDisplay struct {
	// Enabled 关着的时候整套限流不生效，页面必须如实说"未启用"而不是列一张表。
	Enabled bool `json:"enabled"`
	// DurationMinutes 是计数窗口长度，单位分钟。
	DurationMinutes int `json:"duration_minutes"`
	// Groups 按分组名升序，只含调用方可见的分组。
	Groups []GroupRateLimit `json:"groups"`
}

// ResolveRateLimitDisplay 按「当前用户可见的分组」算出各分组实际生效的限流额度。
//
// 只吐可见分组，理由和 ResolveGroupDisplay 一样：否则等于把别人的分组名泄露给所有访客。
func ResolveRateLimitDisplay(visibleGroups map[string]string) RateLimitDisplay {
	display := RateLimitDisplay{
		Enabled:         setting.ModelRequestRateLimitEnabled,
		DurationMinutes: setting.ModelRequestRateLimitDurationMinutes,
		Groups:          make([]GroupRateLimit, 0, len(visibleGroups)),
	}
	if !display.Enabled {
		return display
	}

	names := make([]string, 0, len(visibleGroups))
	for group := range visibleGroups {
		names = append(names, group)
	}
	sort.Strings(names)

	for _, group := range names {
		limit := GroupRateLimit{
			Group:        group,
			TotalCount:   setting.ModelRequestRateLimitCount,
			SuccessCount: setting.ModelRequestRateLimitSuccessCount,
		}
		if total, success, found := setting.GetGroupRateLimit(group); found {
			limit.TotalCount = total
			limit.SuccessCount = success
			limit.Overridden = true
		}
		display.Groups = append(display.Groups, limit)
	}
	return display
}
