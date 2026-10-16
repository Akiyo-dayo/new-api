package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 渠道亲和记的是「上次成功的那个渠道」，包括便宜层被 auto-ban 期间降级过去的贵渠道。
// 便宜层恢复后没人重新比价，亲和会把区间令牌钉在贵价位上直到 TTL 到期（默认 3600 秒），
// 直接推翻 selectRatioRangeChannel 声明的「用户永远拿到区间内当下能拿到的最低价」。
func TestAffinityKeepsLowestAvailablePriceDropsAffinityAfterCheapTierRecovers(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.1,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 8101, Group: "cheap", Models: "probe-model"},
		{Id: 8102, Group: "pricey", Models: "probe-model"},
	})

	assert.False(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "pricey", "probe-model", ""),
		"cheap(0.1) 此刻有可用渠道，亲和却钉在 pricey(0.3) 上，必须放弃亲和")
}

// 便宜那层确实没有该模型的可用渠道时，亲和到贵分组是当下唯一的选择，不该被判成「更贵」，
// 否则一放弃亲和就退回选路、选路又只能选回同一层，白丢一次会话粘性。
func TestAffinityKeepsLowestAvailablePriceKeepsAffinityWhileCheapTierHasNoChannel(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.1,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 8111, Group: "cheap", Models: "other-model"},
		{Id: 8112, Group: "pricey", Models: "probe-model"},
	})

	assert.True(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "pricey", "probe-model", ""),
		"cheap 下没有 probe-model 的渠道，pricey 就是当下的最低可用价")
}

// 亲和分组本来就在最便宜那层：必须保留亲和。修这个 bug 不能把亲和整个废掉。
func TestAffinityKeepsLowestAvailablePriceKeepsAffinityAtCheapestTier(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.1,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 8121, Group: "cheap", Models: "probe-model"},
		{Id: 8122, Group: "pricey", Models: "probe-model"},
	})

	assert.True(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "cheap", "probe-model", ""))
}

// 同价位的另一个分组有可用渠道时不算「更便宜」：倍率相等要保留亲和，
// 否则同价轮询会把每一次请求都从亲和渠道上踢走，粘性彻底失效而用户一分钱也没省。
func TestAffinityKeepsLowestAvailablePriceKeepsAffinityOnEqualRatio(t *testing.T) {
	withGroupSettings(t,
		`{"cheap-a":"便宜A","cheap-b":"便宜B","pricey":"贵"}`,
		`{"cheap-a":0.1,"cheap-b":0.1,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 8131, Group: "cheap-a", Models: "probe-model"},
		{Id: 8132, Group: "cheap-b", Models: "probe-model"},
	})

	assert.True(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "cheap-b", "probe-model", ""),
		"cheap-a 与 cheap-b 同为 0.1，不构成降价理由")
}

// 比价必须用 effectiveGroupRatio 那一份真值：GroupGroupRatio 的覆盖价优先于 GroupRatio。
// 这里 tester 用 cheap 的实际价被覆盖成 0.25，比 mid 的 0.2 还贵，
// 拿名义倍率（cheap=0.1）比就会得出「亲和已经是最便宜」的错误结论。
func TestAffinityKeepsLowestAvailablePriceUsesGroupGroupRatioOverride(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","mid":"中","pricey":"贵"}`,
		`{"cheap":0.1,"mid":0.2,"pricey":0.3}`,
		`{"tester":{"cheap":0.25}}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 8141, Group: "cheap", Models: "probe-model"},
		{Id: 8142, Group: "mid", Models: "probe-model"},
	})

	require.Equal(t, []string{"mid", "cheap", "pricey"},
		groupNames(GetUserGroupsInRatioRange("tester", ratio_setting.RatioRange{Min: 0.1, Max: 0.3})),
		"覆盖价把 cheap 抬到 0.25，排序上应落在 mid 之后")
	assert.False(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "cheap", "probe-model", ""),
		"mid 对 tester 实际是 0.2，比被覆盖成 0.25 的 cheap 便宜，必须放弃亲和")
}

// auto 的语义是**按 auto_groups 的配置顺序回退**而不是最低价优先。
// 把这条比价套到 auto 上等于偷偷改掉 auto 的既有语义。
func TestAffinityKeepsLowestAvailablePriceLeavesAutoAndRealGroupsAlone(t *testing.T) {
	// free(0) 是这条用例里最关键的一个分组，虽然它跟 auto 的语义无关。
	//
	// 没有它的时候，把 `if !isRatioRange || rangeErr != nil { return true }` 整段删掉
	// 这条变异**存活**：ratioRange 变成零值 RatioRange{0,0}，而 Contains 是
	// `ratio >= Min && ratio <= Max`，对 0.1 / 0.3 都返回 false → 候选为空 → 循环不执行
	// → 照样 return true，用例照样绿。只有区间里真的落进一个倍率为 0 的分组，
	// 零值区间才会「命中」，删除式变异才会被杀。
	//
	// 这正是「删除式变异会假绿」的教科书例子：断言没错，是被兜底路径救回来了。
	withGroupSettings(t,
		`{"free":"免费","cheap":"便宜","pricey":"贵"}`,
		`{"free":0,"cheap":0.1,"pricey":0.3}`,
		`{}`)
	originalAuto := setting.AutoGroups2JsonString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAuto)) })
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["pricey","cheap"]`))
	seedChannelGroups(t, []model.Channel{
		{Id: 8150, Group: "free", Models: "probe-model"},
		{Id: 8151, Group: "cheap", Models: "probe-model"},
		{Id: 8152, Group: "pricey", Models: "probe-model"},
	})

	assert.True(t, AffinityKeepsLowestAvailablePrice("auto", "tester", "pricey", "probe-model", ""),
		"auto 按配置顺序回退，pricey 排在前面就是它该用的分组")
	assert.True(t, AffinityKeepsLowestAvailablePrice("pricey", "tester", "pricey", "probe-model", ""),
		"绑定具体分组的令牌只有一个价位可言，不该被比价拦下")
}

// 亲和分组没配倍率时必须放弃亲和：算不出价位就无从证明它不比别人贵，而计费那边
// GetGroupRatio 对未知分组回落 1.0（原价），站点正常倍率是 0.1~0.3 量级，放行一次就是
// 三倍以上的多收——正是这条守卫要拦的方向。
//
// 这个状态今天不可达：affinityGroup 来自 ResolveChannelBillingGroup，而它的候选只来自
// GetUserGroupsInRatioRange，那里已经用同一个 effectiveGroupRatio 把未定价分组滤掉了。
// 留着是纵深防御——将来若有第二个调用方直接传分组名进来，这里是最后一道。
// 等到确认不会再有别的调用方（或候选来源统一收口）时，这条用例可以连同那个分支一起删。
func TestAffinityKeepsLowestAvailablePriceDropsUnpricedAffinityGroup(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.1,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 8161, Group: "cheap", Models: "probe-model"},
		{Id: 8162, Group: "unpriced", Models: "probe-model"},
	})

	assert.False(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "unpriced", "probe-model", ""),
		"unpriced 不在 GroupRatio 也不在 GroupGroupRatio，计费会按 1.0 走，必须放弃亲和")
	assert.True(t, AffinityKeepsLowestAvailablePrice("ratio:0.1-0.3", "tester", "cheap", "probe-model", ""),
		"反证：同一份配置下已定价的分组仍然保留亲和，上面那条 false 不是因为环境没搭起来")
}
