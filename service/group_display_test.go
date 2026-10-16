package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withGroupDisplayConfig(t *testing.T, jsonString string) {
	t.Helper()
	original := setting.GroupDisplay2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateGroupDisplayByJSONString(original))
	})
	require.NoError(t, setting.UpdateGroupDisplayByJSONString(jsonString))
}

func displayedGroups(payload GroupDisplayPayload) []string {
	names := make([]string, 0, len(payload.Groups))
	for _, item := range payload.Groups {
		names = append(names, item.Group)
	}
	return names
}

// 没配过的分组按倍率自动判定：倍率为 0 的免费分组默认收起，收费分组照常显示。
func TestResolveGroupDisplayHidesFreeGroupsByDefault(t *testing.T) {
	withGroupDisplayConfig(t, `{"groups":[],"categories":[]}`)

	payload := ResolveGroupDisplay(map[string]float64{
		"免费渠道":    0,
		"浅夜促销GPT": 0.1375,
	})

	require.Len(t, payload.Groups, 2)
	byGroup := map[string]bool{}
	for _, item := range payload.Groups {
		byGroup[item.Group] = item.HiddenByDefault
	}
	assert.True(t, byGroup["免费渠道"])
	assert.False(t, byGroup["浅夜促销GPT"])
}

// 显式配置要能双向覆盖自动判定：零价分组放出来、收费分组藏起来都得生效。
// 这条是 HiddenByDefault 用指针的理由——用 bool 的话「显式配成不隐藏」和「没配过」
// 长得一样，零价分组下次读配置又会被藏回去。
func TestResolveGroupDisplayExplicitOverrideBeatsRatio(t *testing.T) {
	withGroupDisplayConfig(t, `{"groups":[
		{"group":"免费渠道","hidden_by_default":false},
		{"group":"浅夜促销GPT","hidden_by_default":true}
	],"categories":[]}`)

	payload := ResolveGroupDisplay(map[string]float64{
		"免费渠道":    0,
		"浅夜促销GPT": 0.1375,
	})

	byGroup := map[string]bool{}
	for _, item := range payload.Groups {
		byGroup[item.Group] = item.HiddenByDefault
	}
	assert.False(t, byGroup["免费渠道"], "显式放出来的零价分组不该被藏")
	assert.True(t, byGroup["浅夜促销GPT"], "显式藏起来的收费分组不该被放出来")
}

// 配置里的顺序就是展示顺序；没配过的排在后面并按名称排序，
// 否则新建分组会凭 map 遍历顺序随机插队。
func TestResolveGroupDisplayOrdersConfiguredFirst(t *testing.T) {
	withGroupDisplayConfig(t, `{"groups":[
		{"group":"浅夜专属GPT"},
		{"group":"Snow普通GPT"}
	],"categories":[]}`)

	payload := ResolveGroupDisplay(map[string]float64{
		"Snow普通GPT": 0.18,
		"浅夜专属GPT":   0.275,
		"zzz新分组":    0.3,
		"aaa新分组":    0.4,
	})

	assert.Equal(t, []string{"浅夜专属GPT", "Snow普通GPT", "aaa新分组", "zzz新分组"}, displayedGroups(payload))
}

// 用户看不到的分组不能出现在广场配置里，否则等于把别人的分组名泄露给所有访客。
func TestResolveGroupDisplaySkipsGroupsUserCannotSee(t *testing.T) {
	withGroupDisplayConfig(t, `{"groups":[
		{"group":"内部专用"},
		{"group":"浅夜促销GPT"}
	],"categories":[]}`)

	payload := ResolveGroupDisplay(map[string]float64{"浅夜促销GPT": 0.1375})

	assert.Equal(t, []string{"浅夜促销GPT"}, displayedGroups(payload))
}

// 归类列表只能包含真被用到的归类，且默认收起——给分组指定归类这个动作本身就是为了收纳。
func TestResolveGroupDisplayCategories(t *testing.T) {
	withGroupDisplayConfig(t, `{"groups":[
		{"group":"Akiyo自有反重力","category":"Akiyo"},
		{"group":"Snow普通GPT","category":"Snow"},
		{"group":"看不见的","category":"幽灵归类"}
	],"categories":[
		{"name":"Snow","default_expanded":true},
		{"name":"幽灵归类","default_expanded":true}
	]}`)

	payload := ResolveGroupDisplay(map[string]float64{
		"Akiyo自有反重力": 0.27,
		"Snow普通GPT":  0.18,
	})

	require.Len(t, payload.Categories, 2)
	assert.Equal(t, "Snow", payload.Categories[0].Name)
	assert.True(t, payload.Categories[0].DefaultExpanded)
	assert.Equal(t, "Akiyo", payload.Categories[1].Name, "分组上写了归类但归类没单独配过，要补一条")
	assert.False(t, payload.Categories[1].DefaultExpanded, "没配过的归类默认收起")
}
