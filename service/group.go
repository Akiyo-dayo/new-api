package service

import (
	"sort"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

func GetUserUsableGroups(userGroup string) map[string]string {
	groupsCopy := setting.GetUserUsableGroupsCopy()
	if userGroup != "" {
		specialSettings, b := ratio_setting.GetGroupRatioSetting().GroupSpecialUsableGroup.Get(userGroup)
		if b {
			// 处理特殊可用分组
			for specialGroup, desc := range specialSettings {
				if after, ok := strings.CutPrefix(specialGroup, "-:"); ok {
					// 移除分组
					groupToRemove := after
					delete(groupsCopy, groupToRemove)
				} else if after, ok := strings.CutPrefix(specialGroup, "+:"); ok {
					// 添加分组
					groupToAdd := after
					groupsCopy[groupToAdd] = desc
				} else {
					// 直接添加分组
					groupsCopy[specialGroup] = desc
				}
			}
		}
		// 如果userGroup不在UserUsableGroups中，返回UserUsableGroups + userGroup。
		// 描述是英文源文本，由 web 控制台翻译；管理员配置的描述原样显示。
		if _, ok := groupsCopy[userGroup]; !ok {
			groupsCopy[userGroup] = "User group"
		}
	}
	return groupsCopy
}

func GroupInUserUsableGroups(userGroup, groupName string) bool {
	_, ok := GetUserUsableGroups(userGroup)[groupName]
	return ok
}

func IsUserSelectableGroup(userGroup, groupName string) bool {
	if groupName == "" || groupName == "auto" {
		return false
	}
	return GroupInUserUsableGroups(userGroup, groupName) && GroupHasConfiguredRatio(userGroup, groupName)
}

// GetUserAutoGroup 根据用户分组获取自动分组设置
func GetUserAutoGroup(userGroup string) []string {
	autoGroups := make([]string, 0)
	seen := make(map[string]struct{})
	for _, group := range setting.GetAutoGroups() {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		autoGroups = append(autoGroups, group)
	}
	return autoGroups
}

// FilterUserTokenAutoGroups applies current permissions before the current
// per-token limit. It intentionally does not fall back to the global Auto list.
func FilterUserTokenAutoGroups(userGroup string, groups []string) []string {
	maxCount := setting.GetMaxTokenAutoGroups()
	filtered := make([]string, 0, min(len(groups), maxCount))
	seen := make(map[string]struct{})
	for _, group := range groups {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, ok := seen[group]; ok {
			continue
		}
		seen[group] = struct{}{}
		filtered = append(filtered, group)
		if len(filtered) == maxCount {
			break
		}
	}
	return filtered
}

// GetRequestAutoGroups resolves the ordered Auto groups for the current token.
// The absence of the context value means that the token inherits the complete
// global Auto list; a present (even empty) value is an explicit token snapshot.
func GetRequestAutoGroups(c *gin.Context, userGroup string) []string {
	value, ok := common.GetContextKey(c, constant.ContextKeyTokenAutoGroups)
	if !ok {
		return GetUserAutoGroup(userGroup)
	}
	groups, ok := value.([]string)
	if !ok {
		return []string{}
	}
	return FilterUserTokenAutoGroups(userGroup, groups)
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
