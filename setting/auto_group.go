package setting

import (
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var autoGroups = []string{
	"default",
}

// autoGroupsMutex 保护 autoGroups。
//
// 这个切片由 model.SyncOptions 每 SYNC_FREQUENCY 秒（默认 60）无条件重放一次
// （loadOptionsFromDatabase → updateOptionMap → UpdateAutoGroupsByJsonString），
// 而读侧就在选路热路径上：service/channel_select.go 判断 auto 分组是否启用、
// service/group.go 遍历候选分组。原来读写两侧一把锁都没有，写还是「先清空、再往同一个
// 包级变量里 unmarshal」——边 append 边扩容、反复重写切片头。
//
// 复核实测（8 读 goroutine × 20 万次 + 1 写 goroutine）：读到 len==0 六十余万次
// （选路直接 "auto groups is not enabled" → 503）、读到被截断的候选八十余万次、
// 读到空串分组名二十余万次。生产上窗口是每 60 秒几微秒，但确实可达。
//
// 与 setting/rate_limit.go 那处同类，修法也一样：写侧先解析到局部再整体替换，
// 读侧持读锁并返回副本——返回切片头等于把内部状态漏出去，调用方一个 append 就能就地改写。
var autoGroupsMutex sync.RWMutex

var DefaultUseAutoGroup = false

func ContainsAutoGroup(group string) bool {
	autoGroupsMutex.RLock()
	defer autoGroupsMutex.RUnlock()

	for _, autoGroup := range autoGroups {
		if autoGroup == group {
			return true
		}
	}
	return false
}

func UpdateAutoGroupsByJsonString(jsonString string) error {
	updated := make([]string, 0)
	if err := common.Unmarshal([]byte(jsonString), &updated); err != nil {
		return err
	}

	autoGroupsMutex.Lock()
	defer autoGroupsMutex.Unlock()

	autoGroups = updated
	return nil
}

func AutoGroups2JsonString() string {
	autoGroupsMutex.RLock()
	defer autoGroupsMutex.RUnlock()

	jsonBytes, err := common.Marshal(autoGroups)
	if err != nil {
		return "[]"
	}
	return string(jsonBytes)
}

// GetAutoGroups 返回 auto 分组列表的副本，按配置顺序（auto 是顺序回退，顺序即语义）。
func GetAutoGroups() []string {
	autoGroupsMutex.RLock()
	defer autoGroupsMutex.RUnlock()

	groups := make([]string, len(autoGroups))
	copy(groups, autoGroups)
	return groups
}
