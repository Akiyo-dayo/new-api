package service

import (
	"strconv"
	"sync"
	"sync/atomic"
)

// groupRotationBucketSep 分隔轮询分桶键里的「模型」与「价位」两段。
// 用 NUL 是因为模型名可能含常见标点，普通分隔符会撞键。
const groupRotationBucketSep = "\x00"

// groupRotationCursorCap 是游标数量上限。分桶键含模型名，模型会被改名或下线，
// 桶只增不减，所以需要一个上限。超过就整体丢弃：游标只是「本轮从第几个分组开始」，
// 丢了最多让下一次请求从该价位的第 0 个分组重新开始，不影响计费也不影响可用性。
//
// 上限取得远高于现实规模（模型数 × 每个模型的价位数），正常运行不会触发。
const groupRotationCursorCap = 4096

// groupRotationCursors 是同价分组的轮询游标，bucketKey -> *atomic.Uint64。
//
// 刻意不复用 model.ChannelInfo.MultiKeyPollingIndex 那套：
//   - 那个游标存在缓存里的 DB 结构体上，指针可能来自缓存活对象，也可能来自
//     GetChannelById 的一次性副本，后者改了就丢；
//   - 那个游标写侧持 GetChannelPollingLock、读侧走 channelSyncLock.RLock，
//     两把不同的锁保护同一块内存。
//
// 这里游标是独立内存，唯一所有者就是 atomic 本身，不存在第二把锁。
// 生产是单实例部署，进程重启游标归零：同价分组只是换个起点，无害。
var groupRotationCursors sync.Map

var groupRotationCursorCount atomic.Int64

// nextGroupRotationIndex 返回本次请求在「同一价位的候选分组」列表里的起始下标。
//
// 只有同价才轮询：跨价位的先后顺序由价格决定（便宜的先试），不归游标管。
// 分桶键是「模型 + 价位」而不是裸价位：同一价位下不同模型的可用分组集合不同，
// 共用一个游标会让部分分组长期排不到队首。
//
// 取游标的逻辑只有这一处，将来要换成 Redis 或别的横向扩展实现只改这个函数。
func nextGroupRotationIndex(modelName string, ratio float64, n int) int {
	if n <= 1 {
		return 0
	}
	// 价位用能精确还原的最短写法，0.1375 不会和 0.14 撞进同一个桶。
	bucketKey := modelName + groupRotationBucketSep + strconv.FormatFloat(ratio, 'f', -1, 64)
	value, loaded := groupRotationCursors.Load(bucketKey)
	if !loaded {
		var stored bool
		value, stored = groupRotationCursors.LoadOrStore(bucketKey, new(atomic.Uint64))
		if !stored && groupRotationCursorCount.Add(1) > groupRotationCursorCap {
			ResetGroupRotationCursors()
		}
	}
	cursor := value.(*atomic.Uint64)
	// Add 返回自增后的值，减一让同一个桶的第一次调用落在下标 0。
	return int((cursor.Add(1) - 1) % uint64(n))
}

// ResetGroupRotationCursors 丢弃全部轮询游标。
func ResetGroupRotationCursors() {
	groupRotationCursors.Range(func(key, _ any) bool {
		groupRotationCursors.Delete(key)
		return true
	})
	groupRotationCursorCount.Store(0)
}
