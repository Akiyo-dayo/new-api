package model

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func pricingRowsByModel(t *testing.T) map[string]Pricing {
	t.Helper()
	InitChannelCache()
	rows := make(map[string]Pricing)
	for _, row := range GetPricing() {
		rows[row.ModelName] = row
	}
	return rows
}

// GetModelRatio 对没配过价的模型返回兜底的 37.5，前端拿它当真价算出来就是编出来的
// 「$11.25/1M」，而真正调用会被 modelPriceNotConfiguredError 拒掉。PriceConfigured
// 就是用来把这两种模型分开的，广场靠它决定标不标价。
func TestPricingMarksUnconfiguredModels(t *testing.T) {
	resetPricingEndpointTestTables(t)

	originalRatio := ratio_setting.ModelRatio2JSONString()
	originalSelfUse := operation_setting.SelfUseModeEnabled
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatio))
		operation_setting.SelfUseModeEnabled = originalSelfUse
		InvalidatePricingCache()
	})
	operation_setting.SelfUseModeEnabled = false
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"zz-priced-model":1.5}`))

	insertPricingEndpointChannel(t, 9101, 1, pricingEndpointAdvancedCustomConfig())
	insertPricingEndpointAbility(t, 9101, "zz-priced-model")
	insertPricingEndpointAbility(t, 9101, "zz-unpriced-model")
	InvalidatePricingCache()

	rows := pricingRowsByModel(t)
	require.Contains(t, rows, "zz-priced-model")
	require.Contains(t, rows, "zz-unpriced-model")

	assert.True(t, rows["zz-priced-model"].PriceConfigured)
	assert.Equal(t, 1.5, rows["zz-priced-model"].ModelRatio)

	assert.False(t, rows["zz-unpriced-model"].PriceConfigured)
	// 兜底值仍然照发：字段本身是老契约，改它会动到别的读取方；标记的作用是让前端
	// 知道这个数字不能当价格用。
	assert.Equal(t, 37.5, rows["zz-unpriced-model"].ModelRatio)
}

// 自用模式下没配价的模型是真能调用、也真按 37.5 扣费的，所以那时标出来的价格是实价，
// 广场应当照常显示。PriceConfigured 跟着 GetModelRatio 的判定走，正是为了这一点。
func TestPricingTreatsUnconfiguredAsPricedInSelfUseMode(t *testing.T) {
	resetPricingEndpointTestTables(t)

	originalRatio := ratio_setting.ModelRatio2JSONString()
	originalSelfUse := operation_setting.SelfUseModeEnabled
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalRatio))
		operation_setting.SelfUseModeEnabled = originalSelfUse
		InvalidatePricingCache()
	})
	operation_setting.SelfUseModeEnabled = true
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{}`))

	insertPricingEndpointChannel(t, 9102, 1, pricingEndpointAdvancedCustomConfig())
	insertPricingEndpointAbility(t, 9102, "zz-unpriced-model")
	InvalidatePricingCache()

	assert.True(t, pricingRowsByModel(t)["zz-unpriced-model"].PriceConfigured)
}
