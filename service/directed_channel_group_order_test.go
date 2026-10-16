package service

import (
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ResolveDirectedChannelBillingGroup 决定「定向到本令牌分组之外的渠道时怎么办」。
//
// 答案是**拒绝**，不是替它挑一个分组。绑定具体分组的令牌说的是「按这个分组计费」，
// 渠道不在这个分组里时，任何替它挑的做法都是猜，而猜错的方向不可控：
// 曾经的实现是「用户可用分组按倍率升序取第一个挂着该渠道的」，于是
//   - 渠道只挂在更贵的组里 → 少收（这条修复本来要解决的）
//   - 渠道恰好也挂在免费组下 → **按 0 计费**（比原来更糟，见下一条用例）
//
// 两个方向都错，所以不猜。
func TestResolveDirectedChannelBillingGroupRefusesChannelOutsideTokenGroup(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","mid":"中","pricey":"贵"}`,
		`{"cheap":0.15,"mid":0.2,"pricey":0.3}`,
		`{}`)
	// 渠道同时挂在 mid 与 pricey 下，但都不是令牌绑定的 cheap
	seedChannelGroups(t, []model.Channel{
		{Id: 9901, Group: "mid,pricey", Models: "probe-model"},
		{Id: 9902, Group: "cheap", Models: "other-model"},
	})

	group, override, err := ResolveDirectedChannelBillingGroup("cheap", "tester", "probe-model", 9901)

	require.Error(t, err, "没有可辩护的计费依据时必须拒绝，不能挑一个分组顶上")
	assert.True(t, override, "拒绝也要让调用方知道这条路径需要它处理")
	assert.Empty(t, group, "拒绝时绝不能同时给出一个猜出来的分组")
}

// 渠道恰好也挂在免费组下是最危险的一种：按「取最便宜的候选」会回推出 free，按 0 计费。
func TestResolveDirectedChannelBillingGroupRefusesRatherThanFallingIntoFreeGroup(t *testing.T) {
	withGroupSettings(t,
		`{"free":"免费","snow":"雪","gpt":"GPT"}`,
		`{"free":0,"snow":0.18,"gpt":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9904, Group: "free,gpt", Models: "probe-model"},
	})

	group, _, err := ResolveDirectedChannelBillingGroup("snow", "tester", "probe-model", 9904)

	require.Error(t, err)
	assert.NotEqual(t, "free", group, "绝不能因为渠道也挂在免费组下就按 0 计费")
	assert.Empty(t, group)
}

// 令牌分组本来就挂着该渠道时，这条新逻辑必须完全不介入：
// 既不改计费分组，也不能把一个正常的定向调用挡成 403。
func TestResolveDirectedChannelBillingGroupLeavesMatchingTokenGroupAlone(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.15,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9903, Group: "cheap,pricey", Models: "probe-model"},
	})

	group, override, err := ResolveDirectedChannelBillingGroup("cheap", "tester", "probe-model", 9903)

	require.NoError(t, err)
	assert.False(t, override, "令牌分组已挂着该渠道，不该改写计费分组")
	assert.Empty(t, group)
}

// 一批请求根本不带模型名：MJ 的 task fetch / fetch-by-condition / notify、
// Suno 的 fetch、/v1/videos/.../remix —— getModelRequest 对它们
// shouldSelectChannel=false，modelRequest.Model 是空串。
//
// 这类请求不选路也不计费，定向调用时这条逻辑必须完全不介入。
// 一旦介入就会 403：IsChannelEnabledForGroupModel 的第一行就是
// 「modelName == "" 返回 false」，于是"核不上就拒绝"会把它们全挡掉。
// 而定向 key 的典型用法恰恰是「提交时把任务钉在某个渠道上，之后用同一把 key 取结果」。
func TestResolveDirectedChannelBillingGroupIgnoresRequestsWithoutModelName(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜"}`,
		`{"cheap":0.15}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9905, Group: "cheap", Models: "probe-model"},
	})

	group, override, err := ResolveDirectedChannelBillingGroup("cheap", "tester", "", 9905)

	require.NoError(t, err, "不带模型名的请求（MJ/Suno 取结果等）不该被定向计费校验挡掉")
	assert.False(t, override)
	assert.Empty(t, group)
}

// 伪分组令牌走同一条定向入口，同样不能被空模型名挡住。
// 这条洞是「回推不出来就 403」最早引入的，不是「拒绝真实分组」那版才有的。
func TestResolveDirectedChannelBillingGroupIgnoresPseudoGroupWithoutModelName(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.15,"pricey":0.3}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9906, Group: "cheap", Models: "probe-model"},
	})

	group, override, err := ResolveDirectedChannelBillingGroup("ratio:0.1-0.4", "tester", "", 9906)

	require.NoError(t, err, "倍率区间令牌取任务结果时同样不该被挡")
	assert.False(t, override)
	assert.Empty(t, group)
}
