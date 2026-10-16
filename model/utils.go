package model

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net"
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

// deltaMayHaveLanded 报告这笔增量**有没有可能已经写进数据库了**。
//
// 三个落库函数都是不带幂等键的 `col = col + ?`，所以「放回缓冲区重放」只在能确定那条
// UPDATE 没生效时才安全。服务端已经提交、只是客户端没读到应答（连接被 LB 掐掉、主备切换、
// 语句超时）时重放，就是同一笔扣费扣两次——而消费日志只有一笔，事后对账对不出来，
// 方向还是多扣用户的钱。
//
// 判据是「服务端拒绝」还是「连接出事」：
//
//   - 服务端返回的错误（表不存在、约束冲突、语法错误）说明那条语句被处理并拒绝了，
//     确定没有副作用 → 可以重放。
//   - 网络错误 / EOF / context 超时或取消 说明语句发出去了但没拿到答复 → 无法判断
//     到底提交没提交 → 不重放。
//
// `driver.ErrBadConn` 与 `sql.ErrConnDone` 归到「可以重放」：驱动的契约明确写着
// 「只要存在服务端可能已执行的可能性，就不许返回 ErrBadConn」，而 ErrConnDone 意味着
// 连接早已归还，语句根本没发出去。
//
// 判据本身判错时的方向：把一个其实没落库的错误判成「可能落库了」，结果是丢一笔
// 增量（少扣，且有日志可查），好过多扣。
func deltaMayHaveLanded(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, driver.ErrBadConn) || errors.Is(err, sql.ErrConnDone) {
		return false
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return true
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	return errors.As(err, &netErr)
}

// retryOrReport 决定一笔落库失败的增量是放回缓冲区还是就地放弃。
//
// 放弃时必须留下能对账的痕迹：类型、id、金额一个都不能少，否则这笔钱既没进库也没人知道。
func retryOrReport(type_ int, id int, value int, err error, what string) {
	if deltaMayHaveLanded(err) {
		common.SysError(fmt.Sprintf(
			"batch update %s dropped to avoid double charging: id=%d delta=%d err=%v "+
				"(语句已发出但没拿到应答，无法确定是否已提交；如需补账请按这条日志人工核对)",
			what, id, value, err))
		return
	}
	common.SysError(fmt.Sprintf("failed to batch update %s, will retry: id=%d delta=%d err=%v",
		what, id, value, err))
	addNewRecord(type_, id, value)
}

// restoreRecord 把一笔没能落库的增量放回缓冲区，等下一轮重试。
//
// batchUpdate 是「先把 store 换成空的、再逐条应用」，应用失败如果只打日志，那笔扣费就
// 永远消失了。放回去是安全的：缓冲区按 id 累加，期间新到的增量会和它合并，不会重复应用；
// 条目数最多等于活跃用户/令牌/渠道数，不会无限增长。
//
// 但只在 deltaMayHaveLanded 判定「确定没落库」时才走到这里，见 retryOrReport。
func restoreRecord(type_ int, id int, store map[int]int, err error, what string) {
	if value, ok := store[id]; ok {
		retryOrReport(type_, id, value, err, what)
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
					retryOrReport(i, key, value, err, "token quota")
				}
			case BatchUpdateTypeChannelUsedQuota:
				if err := updateChannelUsedQuota(key, value); err != nil {
					retryOrReport(i, key, value, err, "channel used quota")
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
			restoreRecord(BatchUpdateTypeUserQuota, key, userQuotaStore, err, "user quota")
			restoreRecord(BatchUpdateTypeUsedQuota, key, usedQuotaStore, err, "user used quota")
			restoreRecord(BatchUpdateTypeRequestCount, key, requestCountStore, err, "user request count")
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
