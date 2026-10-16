package setting

import (
	"sync"

	"github.com/QuantumNous/new-api/common"
)

// GroupDisplayItem 是模型广场里一个分组的展示配置。
type GroupDisplayItem struct {
	Group string `json:"group"`
	// Category 是折叠归类名（Akiyo / Snow / 浅夜……）。留空表示该分组不参与折叠，
	// 在广场里单独平铺一行。
	Category string `json:"category"`
	// HiddenByDefault 为 nil 表示按倍率自动判定：倍率为 0 的免费分组默认不出现在
	// 「所有分组」的模型列表里。显式 true / false 覆盖自动判定。
	//
	// 用指针而不是 bool，是因为「没配过」和「配成不隐藏」必须区分开：用 bool 的话，
	// 管理员把某个免费分组显式放出来之后，零值和显式 false 长得一样，下次读配置又会
	// 被自动判定重新藏回去。
	HiddenByDefault *bool `json:"hidden_by_default,omitempty"`
}

// GroupDisplayCategory 是折叠归类本身的配置。
type GroupDisplayCategory struct {
	Name string `json:"name"`
	// DefaultExpanded 决定该归类在模型广场里是否默认展开。默认（没配过）是收起：
	// 管理员给分组指定归类这个动作本身就是为了收纳，默认展开等于什么都没收。
	DefaultExpanded bool `json:"default_expanded"`
}

// GroupDisplaySetting 是模型广场的分组展示配置。
//
// 两个数组的**顺序就是展示顺序**（管理端拖动排序的结果直接落在数组顺序上），
// 不另设 order 字段：多一个字段就多一处「数组顺序和 order 不一致时听谁的」的歧义。
type GroupDisplaySetting struct {
	Groups     []GroupDisplayItem     `json:"groups"`
	Categories []GroupDisplayCategory `json:"categories"`
}

var groupDisplaySetting = GroupDisplaySetting{}
var groupDisplayMutex sync.RWMutex

// GetGroupDisplaySettingCopy 返回配置的深拷贝，调用方随便改都不会影响全局状态。
func GetGroupDisplaySettingCopy() GroupDisplaySetting {
	groupDisplayMutex.RLock()
	defer groupDisplayMutex.RUnlock()

	groups := make([]GroupDisplayItem, len(groupDisplaySetting.Groups))
	for i, item := range groupDisplaySetting.Groups {
		groups[i] = item
		if item.HiddenByDefault != nil {
			hidden := *item.HiddenByDefault
			groups[i].HiddenByDefault = &hidden
		}
	}
	categories := make([]GroupDisplayCategory, len(groupDisplaySetting.Categories))
	copy(categories, groupDisplaySetting.Categories)

	return GroupDisplaySetting{Groups: groups, Categories: categories}
}

func UpdateGroupDisplayByJSONString(jsonString string) error {
	parsed := GroupDisplaySetting{}
	if jsonString != "" {
		if err := common.Unmarshal([]byte(jsonString), &parsed); err != nil {
			return err
		}
	}

	groupDisplayMutex.Lock()
	defer groupDisplayMutex.Unlock()
	groupDisplaySetting = parsed
	return nil
}

func GroupDisplay2JSONString() string {
	groupDisplayMutex.RLock()
	defer groupDisplayMutex.RUnlock()

	jsonBytes, err := common.Marshal(groupDisplaySetting)
	if err != nil {
		common.SysLog("error marshalling group display setting: " + err.Error())
		return `{"groups":[],"categories":[]}`
	}
	return string(jsonBytes)
}
