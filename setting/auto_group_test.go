package setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func seedAutoGroups(t *testing.T, seed []string) {
	t.Helper()
	autoGroupsMutex.Lock()
	previous := autoGroups
	autoGroups = seed
	autoGroupsMutex.Unlock()
	t.Cleanup(func() {
		autoGroupsMutex.Lock()
		autoGroups = previous
		autoGroupsMutex.Unlock()
	})
}

// GetAutoGroups 必须返回副本。返回内部切片本身时，调用方的一次 append 就能就地改写
// 全局配置——service.GetUserAutoGroup 正是拿它的返回值做 range 之后再 append 到自己的
// 结果里，只要有人哪天改成复用这个底层数组，auto 分组配置就会被请求悄悄改掉。
func TestGetAutoGroupsReturnsCopy(t *testing.T) {
	seedAutoGroups(t, []string{"snow", "promo"})

	got := GetAutoGroups()
	require.Equal(t, []string{"snow", "promo"}, got)

	got[0] = "tampered"
	got = append(got, "injected")

	assert.Equal(t, []string{"snow", "promo"}, GetAutoGroups(),
		"改动返回值不能影响全局配置")
	assert.True(t, ContainsAutoGroup("snow"))
	assert.False(t, ContainsAutoGroup("tampered"))
}

// 配置损坏时保留上一份，而不是留下一个空列表。
//
// 空列表对 auto 令牌不是「没有偏好」而是**直接不可用**：
// service.CacheGetRandomSatisfiedChannel 见到 len==0 就返回
// "auto groups is not enabled"，请求 503。而 model.SyncOptions 每 60 秒重放一次 options，
// 一旦那一行写坏，原来的实现会把它变成持续的 503。
func TestUpdateAutoGroupsKeepsPreviousConfigOnParseFailure(t *testing.T) {
	seedAutoGroups(t, []string{"snow", "promo"})

	require.Error(t, UpdateAutoGroupsByJsonString(`["snow", "promo"`))

	assert.Equal(t, []string{"snow", "promo"}, GetAutoGroups())
}

// 反证：合法 JSON 确实整体替换，顺序照原样保留——auto 是顺序回退，顺序就是语义。
func TestUpdateAutoGroupsReplacesWholeListInOrder(t *testing.T) {
	seedAutoGroups(t, []string{"snow", "promo"})

	require.NoError(t, UpdateAutoGroupsByJsonString(`["promo","vip","snow"]`))

	assert.Equal(t, []string{"promo", "vip", "snow"}, GetAutoGroups())
	assert.True(t, ContainsAutoGroup("vip"))
}
