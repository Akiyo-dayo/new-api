package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withGroupSettings 把分组相关的三份全局配置换成测试数据，并在用例结束后原样还原。
func withGroupSettings(t *testing.T, usableGroups, groupRatio, groupGroupRatio string) {
	t.Helper()

	originalUsable := setting.UserUsableGroups2JSONString()
	originalRatio := ratio_setting.GroupRatio2JSONString()
	originalGroupGroup := ratio_setting.GroupGroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsable))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatio))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(originalGroupGroup))
	})

	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usableGroups))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groupRatio))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(groupGroupRatio))
}

func groupNames(rows []UserGroupRatio) []string {
	names := make([]string, 0, len(rows))
	for _, row := range rows {
		names = append(names, row.Group)
	}
	return names
}

// 候选顺序会被轮询游标取模，顺序一变、同一个下标这次落在便宜分组、下次落在贵分组，
// 用户就会按自己没预期的倍率被计费。所以按倍率升序、同倍率按名称必须是确定的。
func TestGetUserGroupsInRatioRangeSortsByRatioThenName(t *testing.T) {
	withGroupSettings(t,
		`{"promo":"促销","snow-b":"雪B","snow-a":"雪A","premium":"贵的"}`,
		`{"promo":0.1375,"snow-a":0.2,"snow-b":0.2,"premium":1.1}`,
		`{}`)

	rows := GetUserGroupsInRatioRange("tester", ratio_setting.RatioRange{Min: 0, Max: 0.3})

	assert.Equal(t, []string{"promo", "snow-a", "snow-b"}, groupNames(rows))
	assert.Equal(t, 0.1375, rows[0].Ratio)
}

// 区间是价格上限：区间外的分组一个都不能混进来，否则用户会按超出自己预算的价被计费。
func TestGetUserGroupsInRatioRangeExcludesOutOfRange(t *testing.T) {
	withGroupSettings(t,
		`{"promo":"促销","mid":"中","premium":"贵的"}`,
		`{"promo":0.1375,"mid":0.2,"premium":1.1}`,
		`{}`)

	rows := GetUserGroupsInRatioRange("tester", ratio_setting.RatioRange{Min: 0.15, Max: 0.2})

	assert.Equal(t, []string{"mid"}, groupNames(rows))
}

// GroupGroupRatio 会给特定用户分组覆盖某个分组的价。筛选必须用这个实际生效的价：
// 拿名义价筛会把明明降到预算内的分组挡在外面，或者把已经涨价的分组放进来。
func TestGetUserGroupsInRatioRangeUsesEffectiveRatio(t *testing.T) {
	withGroupSettings(t,
		`{"premium":"贵的","promo":"促销"}`,
		`{"premium":1.1,"promo":0.1375}`,
		`{"vip":{"premium":0.15}}`)

	vipRows := GetUserGroupsInRatioRange("vip", ratio_setting.RatioRange{Min: 0, Max: 0.2})
	assert.Equal(t, []string{"promo", "premium"}, groupNames(vipRows), "vip 按 0.15 计价，premium 应当落在区间内")
	assert.Equal(t, 0.15, vipRows[1].Ratio)

	plainRows := GetUserGroupsInRatioRange("plain", ratio_setting.RatioRange{Min: 0, Max: 0.2})
	assert.Equal(t, []string{"promo"}, groupNames(plainRows), "普通用户按 1.1 计价，premium 不该出现")
}

// 没配倍率的分组没有价，无法判断属于哪个价位。静默按 1.0 处理会把它塞进用户根本没选的
// 价位里；GetGroupRatio 对未知分组正是返回 1，所以这条必须显式挡掉。
func TestGetUserGroupsInRatioRangeSkipsGroupsWithoutRatio(t *testing.T) {
	withGroupSettings(t,
		`{"priced":"有价","unpriced":"没配价"}`,
		`{"priced":1}`,
		`{}`)

	rows := GetUserGroupsInRatioRange("tester", ratio_setting.RatioRange{Min: 0, Max: 5})

	assert.Equal(t, []string{"priced"}, groupNames(rows))
}
