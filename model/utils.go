package model

import (
	"errors"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"

	"github.com/bytedance/gopkg/util/gopool"
	"gorm.io/gorm"
)

const (
	BatchUpdateTypeUserQuota = iota
	BatchUpdateTypeTokenQuota
	BatchUpdateTypeUsedQuota
	BatchUpdateTypeChannelUsedQuota
	BatchUpdateTypeRequestCount
	BatchUpdateTypeCount // if you add a new type, you need to add a new map and a new lock
)

var batchUpdateStores []map[int]int
var batchUpdateLocks []sync.Mutex

func init() {
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateStores = append(batchUpdateStores, make(map[int]int))
		batchUpdateLocks = append(batchUpdateLocks, sync.Mutex{})
	}
}

func InitBatchUpdater() {
	gopool.Go(func() {
		for {
			time.Sleep(time.Duration(common.BatchUpdateInterval) * time.Second)
			batchUpdate()
		}
	})
}

// FlushBatchUpdates 立刻把批量缓冲区里的增量落库。
//
// 进程退出前**必须**调一次。批量模式下缓冲的是真钱：BatchUpdateTypeUserQuota 是用户余额、
// BatchUpdateTypeTokenQuota 是令牌剩余额度，而 InitBatchUpdater 只有一个
// for{sleep;flush} 的循环。少了这一步，每次停机（包括正常的 docker compose up -d 重建）
// 都会丢掉最多一个 BATCH_UPDATE_INTERVAL 的扣费，而消费日志早已写好——
// 结果就是「日志 quota 大于用户 used_quota」，且永远只朝少扣的方向偏。
// 缓冲区为空时是无操作，所以不必判断 BatchUpdateEnabled。
func FlushBatchUpdates() {
	batchUpdate()
}

// restoreRecord 把一笔没能落库的增量放回缓冲区，等下一轮重试。
//
// batchUpdate 是「先把 store 换成空的、再逐条应用」，应用失败如果只打日志，那笔扣费就
// 永远消失了。放回去是安全的：缓冲区按 id 累加，期间新到的增量会和它合并，不会重复应用；
// 条目数最多等于活跃用户/令牌/渠道数，不会无限增长。
func restoreRecord(type_ int, id int, store map[int]int) {
	if value, ok := store[id]; ok {
		addNewRecord(type_, id, value)
	}
}

func addNewRecord(type_ int, id int, value int) {
	batchUpdateLocks[type_].Lock()
	defer batchUpdateLocks[type_].Unlock()
	if _, ok := batchUpdateStores[type_][id]; !ok {
		batchUpdateStores[type_][id] = value
	} else {
		batchUpdateStores[type_][id] += value
	}
}

func batchUpdate() {
	// check if there's any data to update
	hasData := false
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		if len(batchUpdateStores[i]) > 0 {
			hasData = true
			batchUpdateLocks[i].Unlock()
			break
		}
		batchUpdateLocks[i].Unlock()
	}

	if !hasData {
		return
	}

	common.SysLog("batch update started")
	stores := make([]map[int]int, BatchUpdateTypeCount)
	for i := 0; i < BatchUpdateTypeCount; i++ {
		batchUpdateLocks[i].Lock()
		stores[i] = batchUpdateStores[i]
		batchUpdateStores[i] = make(map[int]int)
		batchUpdateLocks[i].Unlock()
	}

	for i, store := range stores {
		if i == BatchUpdateTypeUserQuota || i == BatchUpdateTypeUsedQuota || i == BatchUpdateTypeRequestCount {
			continue
		}
		for key, value := range store {
			switch i {
			case BatchUpdateTypeTokenQuota:
				if err := increaseTokenQuota(key, value); err != nil {
					common.SysError("failed to batch update token quota, will retry: " + err.Error())
					addNewRecord(i, key, value)
				}
			case BatchUpdateTypeChannelUsedQuota:
				if err := updateChannelUsedQuota(key, value); err != nil {
					common.SysError("failed to batch update channel used quota, will retry: " + err.Error())
					addNewRecord(i, key, value)
				}
			}
		}
	}

	userQuotaStore := stores[BatchUpdateTypeUserQuota]
	usedQuotaStore := stores[BatchUpdateTypeUsedQuota]
	requestCountStore := stores[BatchUpdateTypeRequestCount]

	userIDs := make(map[int]struct{}, len(userQuotaStore)+len(usedQuotaStore)+len(requestCountStore))
	for key := range userQuotaStore {
		userIDs[key] = struct{}{}
	}
	for key := range usedQuotaStore {
		userIDs[key] = struct{}{}
	}
	for key := range requestCountStore {
		userIDs[key] = struct{}{}
	}
	for key := range userIDs {
		if err := updateUserQuotaUsedQuotaAndRequestCount(key,
			userQuotaStore[key], usedQuotaStore[key], requestCountStore[key]); err != nil {
			common.SysError("failed to batch update user quota, used quota and request count, will retry: " + err.Error())
			restoreRecord(BatchUpdateTypeUserQuota, key, userQuotaStore)
			restoreRecord(BatchUpdateTypeUsedQuota, key, usedQuotaStore)
			restoreRecord(BatchUpdateTypeRequestCount, key, requestCountStore)
		}
	}
	common.SysLog("batch update finished")
}

func RecordExist(err error) (bool, error) {
	if err == nil {
		return true, nil
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return false, err
}

func shouldUpdateRedis(fromDB bool, err error) bool {
	return common.RedisEnabled && fromDB && err == nil
}
