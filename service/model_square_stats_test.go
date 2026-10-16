package service

import (
	"testing"

	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 名次按请求量降序，请求量相同按模型名——名次每次刷新都抖一下，用户会以为广场排序是随机的。
func TestBuildModelSquareStatsRanksByRequestsThenName(t *testing.T) {
	built := buildModelSquareStats([]perfmetrics.ModelSummary{
		{ModelName: "b-model", RequestCount: 100, SuccessRate: 1},
		{ModelName: "hot", RequestCount: 900, SuccessRate: 1},
		{ModelName: "a-model", RequestCount: 100, SuccessRate: 1},
	})

	require.Len(t, built, 3)
	assert.Equal(t, 1, built["hot"].PopularityRank)
	assert.Equal(t, 2, built["a-model"].PopularityRank)
	assert.Equal(t, 3, built["b-model"].PopularityRank)
}

// 样本不足时不能给成功率：把一个刚上线、只被调用过两次的模型排到成功率末位是误导，
// 所以这里必须是 null 而不是 0。
func TestBuildModelSquareStatsSuccessRateNeedsEnoughSamples(t *testing.T) {
	built := buildModelSquareStats([]perfmetrics.ModelSummary{
		{ModelName: "plenty", RequestCount: 100, SuccessRate: 0.9},
		{ModelName: "sparse", RequestCount: 2, SuccessRate: 0.5},
	})

	require.NotNil(t, built["plenty"].SuccessRate)
	assert.InDelta(t, 0.9, *built["plenty"].SuccessRate, 1e-9)
	assert.Nil(t, built["sparse"].SuccessRate)
}

// 窗口内没有请求的模型不进榜：给它一个名次等于凭空把它排在别人前面或后面。
func TestBuildModelSquareStatsSkipsModelsWithoutTraffic(t *testing.T) {
	built := buildModelSquareStats([]perfmetrics.ModelSummary{
		{ModelName: "idle", RequestCount: 0, SuccessRate: 0},
		{ModelName: "busy", RequestCount: 50, SuccessRate: 0.8},
		{ModelName: "", RequestCount: 999, SuccessRate: 1},
	})

	require.Len(t, built, 1)
	assert.Equal(t, 1, built["busy"].PopularityRank)
}

// 成功率为 0 的模型必须照常上榜：这正是用户最需要在广场上看见的那种模型。
func TestBuildModelSquareStatsKeepsZeroSuccessRate(t *testing.T) {
	built := buildModelSquareStats([]perfmetrics.ModelSummary{
		{ModelName: "broken", RequestCount: 50, SuccessRate: 0},
	})

	require.NotNil(t, built["broken"].SuccessRate)
	assert.Equal(t, 0.0, *built["broken"].SuccessRate)
}
