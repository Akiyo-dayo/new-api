package service

import (
	"testing"

	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withAutoGroups 换掉 AutoGroups 配置并在用例结束后还原。
func withAutoGroups(t *testing.T, autoGroups string) {
	t.Helper()

	original := setting.AutoGroups2JsonString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(original))
	})
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(autoGroups))
}

// 没配倍率的分组不能进 auto 的候选列表。
//
// ratio_setting.GetGroupRatio 对未知分组**回落到 1**（只打一行日志），而站点的正常倍率是
// 0.1~0.4 量级，于是命中这种分组等于按 2.5~7 倍收费。普通单分组令牌不会踩到：
// middleware/auth.go 对没配倍率的分组直接报「分组 X 已被弃用」——但那个检查**特意跳过了
// auto**。倍率区间令牌也不会踩到：GetUserGroupsInRatioRange 会跳过没配倍率的分组。
// 三条路里只有 auto 是没设防的，所以这里补上同一条规则。
func TestGetUserAutoGroupSkipsGroupsWithoutRatio(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","noratio":"没配倍率的","mid":"中"}`,
		`{"cheap":0.15,"mid":0.2}`,
		`{}`)
	withAutoGroups(t, `["noratio","cheap","mid"]`)

	got := GetUserAutoGroup("tester")

	assert.Equal(t, []string{"cheap", "mid"}, got,
		"没配倍率的分组会被 GetGroupRatio 按 1 计费，不能出现在 auto 候选里")
}

// 全部候选都没配倍率时返回空列表：宁可「无可用渠道」也不能按倍率 1 扣一笔。
func TestGetUserAutoGroupReturnsEmptyWhenAllCandidatesUnpriced(t *testing.T) {
	withGroupSettings(t,
		`{"noratio-a":"没配A","noratio-b":"没配B"}`,
		`{"other":0.15}`,
		`{}`)
	withAutoGroups(t, `["noratio-a","noratio-b"]`)

	assert.Empty(t, GetUserAutoGroup("tester"))
}

// GroupGroupRatio 覆盖价同样算「配过倍率」：用户分组 -> 使用分组 有覆盖时，
// GetGroupRatio 的未命中回落根本不会被用到，这类分组不该被误杀。
func TestGetUserAutoGroupKeepsGroupsPricedOnlyByGroupGroupRatio(t *testing.T) {
	withGroupSettings(t,
		`{"vip-only":"只有覆盖价"}`,
		`{}`,
		`{"tester":{"vip-only":0.5}}`)
	withAutoGroups(t, `["vip-only"]`)

	assert.Equal(t, []string{"vip-only"}, GetUserAutoGroup("tester"))
}

// 顺序必须保持 AutoGroups 的配置顺序——auto 是「按站长排的优先级顺序回退」，
// 不是按价格排序，改了顺序等于改了计费落点。
func TestGetUserAutoGroupPreservesConfiguredOrder(t *testing.T) {
	withGroupSettings(t,
		`{"expensive":"贵","cheap":"便宜"}`,
		`{"expensive":1.1,"cheap":0.15}`,
		`{}`)
	withAutoGroups(t, `["expensive","cheap"]`)

	assert.Equal(t, []string{"expensive", "cheap"}, GetUserAutoGroup("tester"))
}

// 兜底回落本身的事实要钉住：一旦它变成别的值，上面几条用例的动机就不成立了。
func TestUnknownGroupRatioFallsBackToOne(t *testing.T) {
	withGroupSettings(t, `{"cheap":"便宜"}`, `{"cheap":0.15}`, `{}`)

	assert.Equal(t, float64(1), ratio_setting.GetGroupRatio("完全没配过的分组"))
}
