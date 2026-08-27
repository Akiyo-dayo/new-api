package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 同价分组之间必须真的均摊：连续请求要依次从不同分组起步，否则「轮询」退化成固定分组，
// 排在后面的上游永远拿不到流量。
func TestNextGroupRotationIndexRoundRobinsPerBucket(t *testing.T) {
	ResetGroupRotationCursors()
	t.Cleanup(ResetGroupRotationCursors)

	got := make([]int, 0, 5)
	for i := 0; i < 5; i++ {
		got = append(got, nextGroupRotationIndex("gpt-5.5", 0.18, 3))
	}
	assert.Equal(t, []int{0, 1, 2, 0, 1}, got)
}

// 分桶键含模型名：同一价位下不同模型的可用分组集合不同，共用一个游标会让部分分组
// 长期排不到队首。
func TestNextGroupRotationIndexBucketsByModelAndRatio(t *testing.T) {
	ResetGroupRotationCursors()
	t.Cleanup(ResetGroupRotationCursors)

	assert.Equal(t, 0, nextGroupRotationIndex("gpt-5.5", 0.18, 2))
	// 换模型：另一个桶，重新从 0 开始
	assert.Equal(t, 0, nextGroupRotationIndex("gpt-5.4", 0.18, 2))
	// 换价位：又是另一个桶
	assert.Equal(t, 0, nextGroupRotationIndex("gpt-5.5", 0.275, 2))
	// 回到第一个桶，接着往下走
	assert.Equal(t, 1, nextGroupRotationIndex("gpt-5.5", 0.18, 2))
}

// 只有一个分组的价位不该消费游标：消费了会让同模型另一个价位的轮询节奏被无关请求带偏。
func TestNextGroupRotationIndexSingleCandidateDoesNotConsume(t *testing.T) {
	ResetGroupRotationCursors()
	t.Cleanup(ResetGroupRotationCursors)

	assert.Equal(t, 0, nextGroupRotationIndex("gpt-5.5", 0.18, 1))
	assert.Equal(t, 0, nextGroupRotationIndex("gpt-5.5", 0.18, 0))
	// 游标没被推进过，两个分组时仍然从 0 起步
	assert.Equal(t, 0, nextGroupRotationIndex("gpt-5.5", 0.18, 2))
}

// 这条是「最低价优先」的核心：无论游标转到哪，便宜价位的分组永远排在贵价位之前。
// 轮询只在同价位内部发生，跨价位轮询会让用户在有便宜分组可用时被按贵的计费。
func TestBuildRatioRangeGroupOrderCheapestLevelFirst(t *testing.T) {
	ResetGroupRotationCursors()
	t.Cleanup(ResetGroupRotationCursors)

	candidates := []UserGroupRatio{
		{Group: "cheap-a", Ratio: 0.1375},
		{Group: "cheap-b", Ratio: 0.1375},
		{Group: "mid", Ratio: 0.18},
		{Group: "pricey-a", Ratio: 0.275},
		{Group: "pricey-b", Ratio: 0.275},
	}

	for i := 0; i < 4; i++ {
		ordered := buildRatioRangeGroupOrder("gpt-5.5", candidates)
		require.Len(t, ordered, len(candidates))
		assert.Subset(t, []string{"cheap-a", "cheap-b"}, ordered[:2], "最便宜的价位必须排在最前")
		assert.Equal(t, "mid", ordered[2])
		assert.Subset(t, []string{"pricey-a", "pricey-b"}, ordered[3:], "最贵的价位必须排在最后")
	}
}

// 同价位内的起点要随请求轮转，而且各价位的轮转互不影响。
func TestBuildRatioRangeGroupOrderRotatesWithinLevel(t *testing.T) {
	ResetGroupRotationCursors()
	t.Cleanup(ResetGroupRotationCursors)

	candidates := []UserGroupRatio{
		{Group: "cheap-a", Ratio: 0.1375},
		{Group: "cheap-b", Ratio: 0.1375},
		{Group: "pricey-a", Ratio: 0.275},
		{Group: "pricey-b", Ratio: 0.275},
	}

	first := buildRatioRangeGroupOrder("gpt-5.5", candidates)
	second := buildRatioRangeGroupOrder("gpt-5.5", candidates)
	third := buildRatioRangeGroupOrder("gpt-5.5", candidates)

	assert.Equal(t, []string{"cheap-a", "cheap-b", "pricey-a", "pricey-b"}, first)
	assert.Equal(t, []string{"cheap-b", "cheap-a", "pricey-b", "pricey-a"}, second)
	assert.Equal(t, first, third, "两个分组的价位应当每两次请求回到同一起点")
}

// 单分组价位在任何一轮里都只能是它自己，不能因为取模算错而丢掉或重复。
func TestBuildRatioRangeGroupOrderKeepsEveryCandidateOnce(t *testing.T) {
	ResetGroupRotationCursors()
	t.Cleanup(ResetGroupRotationCursors)

	candidates := []UserGroupRatio{
		{Group: "only-cheap", Ratio: 0.1},
		{Group: "mid-a", Ratio: 0.2},
		{Group: "mid-b", Ratio: 0.2},
		{Group: "mid-c", Ratio: 0.2},
	}

	for i := 0; i < 6; i++ {
		ordered := buildRatioRangeGroupOrder("gpt-5.5", candidates)
		seen := make(map[string]int, len(ordered))
		for _, group := range ordered {
			seen[group]++
		}
		require.Len(t, seen, len(candidates))
		for _, count := range seen {
			assert.Equal(t, 1, count)
		}
		assert.Equal(t, "only-cheap", ordered[0])
	}
}
