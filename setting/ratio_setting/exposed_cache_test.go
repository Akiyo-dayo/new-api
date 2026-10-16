package ratio_setting

import (
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// exposedDataKeys 是 /api/ratio_config 允许下发的**全部**字段。
//
// 站长的口径是「价格表放开时字段要和原版 NewAPI 完全一致，不能多」。这个端点由
// ExposeRatioEnabled 控制，平时关着，所以多一个字段在测试环境是完全无声的——
// 直到某天开关一开，多出来的那个字段就成了对外泄漏的成本数据。
// 对照：词元联盟的 fork 往这里加了 20+ 个键，含 model_group_pricing。
//
// 这个清单**只能减不能加**。要加字段先想清楚它会不会暴露进货价，再改这里。
var exposedDataKeys = []string{
	"cache_ratio",
	"completion_ratio",
	"create_cache_ratio",
	"model_price",
	"model_ratio",
}

func TestGetExposedDataOnlyReturnsUpstreamKeySet(t *testing.T) {
	InvalidateExposedDataCache()
	t.Cleanup(InvalidateExposedDataCache)

	data := GetExposedData()

	keys := make([]string, 0, len(data))
	for key := range data {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	assert.Equal(t, exposedDataKeys, keys,
		"/api/ratio_config 的字段集变了。多出来的字段一旦包含成本信息，"+
			"ExposeRatioEnabled 打开的那一刻就是进货价外泄")
}

// 缓存返回的必须是副本：调用方改了返回值不能污染下一次的结果，
// 否则一个手滑的 delete 就会让端点少下发一个字段，而且只在缓存过期后才恢复。
func TestGetExposedDataReturnsIndependentCopies(t *testing.T) {
	InvalidateExposedDataCache()
	t.Cleanup(InvalidateExposedDataCache)

	first := GetExposedData()
	require.Contains(t, first, "model_ratio")
	delete(first, "model_ratio")
	first["leaked_cost_field"] = "oops"

	second := GetExposedData()
	assert.Contains(t, second, "model_ratio")
	assert.NotContains(t, second, "leaked_cost_field")
}
