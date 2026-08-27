package service

import (
	"sort"

	"github.com/QuantumNous/new-api/setting"
)

// ResolvedGroupDisplay 是下发给模型广场的单个分组展示信息。
type ResolvedGroupDisplay struct {
	Group string `json:"group"`
	// Category 为空表示该分组不参与折叠，在广场里单独平铺。
	Category string `json:"category,omitempty"`
	// HiddenByDefault 为 true 时，只在这一类分组里出现的模型不进「所有分组」列表。
	HiddenByDefault bool `json:"hidden_by_default"`
}

// GroupDisplayPayload 是 /api/pricing 里的分组展示配置。两个数组的顺序就是展示顺序。
type GroupDisplayPayload struct {
	Groups     []ResolvedGroupDisplay         `json:"groups"`
	Categories []setting.GroupDisplayCategory `json:"categories"`
}

// ResolveGroupDisplay 把管理端配置和当前用户可见的分组倍率合成广场用的展示配置。
//
// groupRatio 是该用户实际可见的分组及其生效倍率（controller.GetPricing 已经按可用分组
// 裁剪过），所以这里出来的结果天然只含用户看得到的分组，不会泄露别人的分组名。
//
// 隐藏判定：显式配过就听配置，没配过就看倍率是否为 0。免费分组默认收起，但管理员随时
// 可以把某个零价分组显式放出来，或者把某个收费分组藏起来。
func ResolveGroupDisplay(groupRatio map[string]float64) GroupDisplayPayload {
	config := setting.GetGroupDisplaySettingCopy()

	ordered := make([]ResolvedGroupDisplay, 0, len(groupRatio))
	placed := make(map[string]bool, len(groupRatio))
	usedCategories := make(map[string]bool)

	appendGroup := func(group string, category string, hiddenOverride *bool) {
		ratio, visible := groupRatio[group]
		if !visible || placed[group] {
			return
		}
		hidden := ratio == 0
		if hiddenOverride != nil {
			hidden = *hiddenOverride
		}
		placed[group] = true
		if category != "" {
			usedCategories[category] = true
		}
		ordered = append(ordered, ResolvedGroupDisplay{
			Group:           group,
			Category:        category,
			HiddenByDefault: hidden,
		})
	}

	for _, item := range config.Groups {
		appendGroup(item.Group, item.Category, item.HiddenByDefault)
	}

	// 没配过的分组排在配置过的后面，按名称排序。管理员新建一个分组却忘了配展示顺序时，
	// 它应该出现在末尾而不是凭 map 遍历顺序随机插队。
	unconfigured := make([]string, 0, len(groupRatio))
	for group := range groupRatio {
		if !placed[group] {
			unconfigured = append(unconfigured, group)
		}
	}
	sort.Strings(unconfigured)
	for _, group := range unconfigured {
		appendGroup(group, "", nil)
	}

	categories := make([]setting.GroupDisplayCategory, 0, len(usedCategories))
	listed := make(map[string]bool, len(config.Categories))
	for _, category := range config.Categories {
		if !usedCategories[category.Name] || listed[category.Name] {
			continue
		}
		listed[category.Name] = true
		categories = append(categories, category)
	}
	// 分组上写了归类名、但归类本身没单独配过：补一条默认收起的。
	remaining := make([]string, 0)
	for name := range usedCategories {
		if !listed[name] {
			remaining = append(remaining, name)
		}
	}
	sort.Strings(remaining)
	for _, name := range remaining {
		categories = append(categories, setting.GroupDisplayCategory{Name: name})
	}

	return GroupDisplayPayload{Groups: ordered, Categories: categories}
}
