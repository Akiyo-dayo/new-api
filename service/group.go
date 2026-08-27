package service

import (
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
)

func GetUserUsableGroups(userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// 处理特殊可用分组
			for specialGroup, desc := range specialSettings {
				if strings.HasPrefix(specialGroup, "-:") {
					// 移除分组
					groupToRemove := strings.TrimPrefix(specialGroup, "-:")
					delete(groupsCopy, groupToRemove)
				} else if strings.HasPrefix(specialGroup, "+:") {
					// 添加分组
					groupToAdd := strings.TrimPrefix(specialGroup, "+:")
					groupsCopy[groupToAdd] = desc
				} else {
					// 直接添加分组
					groupsCopy[specialGroup] = desc
				}
			}
		}
		// 如果userGroup不在UserUsableGroups中，返回UserUsableGroups + userGroup
		if _, ok := groupsCopy[userGroup]; !ok {
			groupsCopy[userGroup] = "用户分组"
		}
	}
	return groupsCopy
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	groups := GetUserUsableGroups(userGroup)
	autoGroups := make([]string, 0)
	for _, group := range setting.GetAutoGroups() {
		if _, ok := groups[group]; !ok {
			continue
		}
		// 没配倍率的分组不能进候选：ratio_setting.GetGroupRatio 对未知分组回落到 1，
		// 而站点的正常倍率是 0.1~0.4 量级，命中一次就是按 2.5~7 倍收费。
		// 普通单分组令牌由 middleware/auth.go 的「分组 X 已被弃用」挡住，但那个检查
		// 特意跳过了 auto；倍率区间令牌由 GetUserGroupsInRatioRange 挡住。auto 是唯一
		// 没设防的一条，这里补齐同一条规则。
		if _, ok := effectiveGroupRatio(userGroup, group); !ok {
			continue
		}
		autoGroups = append(autoGroups, group)
	}
	return autoGroups
}

// effectiveGroupRatio 返回该用户使用该分组时真实生效的倍率，以及这个倍率是不是**配置过**的。
//
// 「配置过」有两种：GroupGroupRatio 里有 (用户分组 -> 使用分组) 的覆盖价，或者 GroupRatio
// 里有该分组。两者都没有时 GetGroupRatio 会回落到 1，那个 1 不是价格而是「查不到」，
// 拿它计费就是凭空多收。判定只此一处，别在调用方各写一遍——本项目已经因为「同一个判据的
// 第二处实现」栽过多次。
// GroupHasConfiguredRatio 报告某个分组对该用户来说有没有配过倍率。
//
// 判据与 relay/helper.HandleGroupRatio 的取值顺序完全一致（先 GroupGroupRatio 覆盖价、
// 再 GroupRatio），所以「这里说配过」等价于「计费时不会落到那个回落值 1」。
// 每一条能让用户选定分组的入口都该过一遍：普通令牌在 middleware/auth.go、
// 倍率区间在 GetUserGroupsInRatioRange、auto 在 GetUserAutoGroup、playground 在
// middleware/distributor.go。
func GroupHasConfiguredRatio(userGroup, group string) bool {
	_, ok := effectiveGroupRatio(userGroup, group)
	return ok
}

func effectiveGroupRatio(userGroup, group string) (float64, bool) {
	if ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group); ok {
		return ratio, true
	}
	if !ratio_setting.ContainsGroupRatio(group) {
		return 0, false
	}
	return ratio_setting.GetGroupRatio(group), true
}

// UserGroupRatio 是一个分组，以及某个用户使用该分组时实际生效的倍率。
type UserGroupRatio struct {
	Group string
	Ratio float64
}

// GetUserGroupsInRatioRange 返回用户可用分组里倍率落在区间内的那些，按倍率升序、
// 同倍率按分组名升序排列。倍率区间令牌的候选分组就是这个列表。
//
// 用的是「该用户实际生效的倍率」而不是分组的名义倍率：GroupGroupRatio 会给特定用户分组
// 覆盖某个分组的价，拿名义价筛选会让用户按自己看不到的价被计费，或者把明明在预算内的
// 分组挡在区间外。
//
// 没有配置倍率的分组直接跳过：没有价就无法判断它属于哪个价位，静默按 1.0 处理会把
// 未定价分组塞进用户根本没选的价位里。
func GetUserGroupsInRatioRange(userGroup string, ratioRange ratio_setting.RatioRange) []UserGroupRatio {
	inRange := make([]UserGroupRatio, 0)
	for group := range GetUserUsableGroups(userGroup) {
		ratio, ok := effectiveGroupRatio(userGroup, group)
		if !ok {
			continue
		}
		if !ratioRange.Contains(ratio) {
			continue
		}
		inRange = append(inRange, UserGroupRatio{Group: group, Ratio: ratio})
	}
	// 顺序必须完全确定：候选列表的下标会被轮询游标取模，顺序一变，同一个下标这次落在
	// 0.1375 的分组上、下次落在 0.275 的，用户就会按自己没预期的倍率被计费。
	sort.Slice(inRange, func(i, j int) bool {
		if inRange[i].Ratio != inRange[j].Ratio {
			return inRange[i].Ratio < inRange[j].Ratio
		}
		return inRange[i].Group < inRange[j].Group
	})
	return inRange
}

// GetGroupsEnabledModels 按 groups 顺序获取各分组启用的模型并去重
func GetGroupsEnabledModels(groups []string) []string {
	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, group := range groups {
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if _, ok := seen[modelName]; !ok {
				seen[modelName] = struct{}{}
				models = append(models, modelName)
			}
		}
	}
	return models
}

// GetUserGroupRatio 获取用户使用某个分组的倍率
// userGroup 用户分组
// group 需要获取倍率的分组
func GetUserGroupRatio(userGroup, group string) float64 {
	ratio, ok := ratio_setting.GetGroupGroupRatio(userGroup, group)
	if ok {
		return ratio
	}
	return ratio_setting.GetGroupRatio(group)
}
