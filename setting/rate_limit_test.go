package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedRateLimitGroups 装一份已知的分组限流配置，并在用例结束后还原。
// 这些是包级全局量，SyncOptions 与中继中间件都读它，用例之间必须互不残留。
func seedRateLimitGroups(t *testing.T, seed map[string][2]int) {
	t.Helper()
	ModelRequestRateLimitMutex.Lock()
	previous := ModelRequestRateLimitGroup
	ModelRequestRateLimitGroup = seed
	ModelRequestRateLimitMutex.Unlock()
	t.Cleanup(func() {
		ModelRequestRateLimitMutex.Lock()
		ModelRequestRateLimitGroup = previous
		ModelRequestRateLimitMutex.Unlock()
	})
}

// 配置损坏时必须原样保留上一份，而不是留下一张空表。
//
// 原实现是「先把 map 清空、再 unmarshal」，所以 options 表里那一行只要写坏了，
// 全站分组限流就会静默退化成全局限流——而且没有任何一处会报出来：
// model.SyncOptions 每 60 秒重放一次 options，updateOptionMap 对这里的返回值只打日志。
func TestUpdateModelRequestRateLimitGroupKeepsPreviousConfigOnParseFailure(t *testing.T) {
	seedRateLimitGroups(t, map[string][2]int{"snow": {0, 600}})

	require.Error(t, UpdateModelRequestRateLimitGroupByJSONString(`{"snow": [0, 600`))

	total, success, found := GetGroupRateLimit("snow")
	assert.True(t, found, "解析失败不能把已生效的分组限流抹掉")
	assert.Equal(t, 0, total)
	assert.Equal(t, 600, success)
}

// 反证：同一个入口喂合法 JSON 时确实会整体替换，删掉的分组要真的消失。
// 没有这一条，上面那条「什么都没发生」的断言可以靠一个空实现通过。
func TestUpdateModelRequestRateLimitGroupReplacesWholeConfig(t *testing.T) {
	seedRateLimitGroups(t, map[string][2]int{"snow": {0, 600}, "promo": {0, 100}})

	require.NoError(t, UpdateModelRequestRateLimitGroupByJSONString(`{"promo": [5, 50]}`))

	total, success, found := GetGroupRateLimit("promo")
	require.True(t, found)
	assert.Equal(t, 5, total)
	assert.Equal(t, 50, success)

	_, _, found = GetGroupRateLimit("snow")
	assert.False(t, found, "新配置里没有的分组必须落回全局限流")
}
