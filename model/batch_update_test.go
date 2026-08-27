package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupBatchUpdateTest 起一个只装 users / tokens / channels 三张表的库，
// 并保证用例结束后批量缓冲区是空的——它是包级全局变量，留下残留会污染别的用例。
func setupBatchUpdateTest(t *testing.T) *gorm.DB {
	t.Helper()

	previousDB := DB
	t.Cleanup(func() {
		DB = previousDB
		for i := 0; i < BatchUpdateTypeCount; i++ {
			batchUpdateLocks[i].Lock()
			batchUpdateStores[i] = make(map[int]int)
			batchUpdateLocks[i].Unlock()
		}
	})

	db, err := gorm.Open(sqlite.Open(
		fmt.Sprintf("file:batch-update-test-%s?mode=memory&cache=shared", common.GetRandomString(8))),
		&gorm.Config{})
	require.NoError(t, err)
	DB = db
	require.NoError(t, db.AutoMigrate(&User{}, &Token{}, &Channel{}))
	require.NoError(t, db.Create(&User{Id: 1, Username: "batch-user", Quota: 1000, UsedQuota: 0}).Error)
	require.NoError(t, db.Create(&Token{Id: 1, UserId: 1, Name: "batch-token", Key: "batchkey00000000", RemainQuota: 500}).Error)
	require.NoError(t, db.Create(&Channel{Id: 1, Name: "batch-channel", UsedQuota: 0}).Error)
	return db
}

func pendingCount(type_ int) int {
	batchUpdateLocks[type_].Lock()
	defer batchUpdateLocks[type_].Unlock()
	return len(batchUpdateStores[type_])
}

// 进程退出前必须把缓冲区落库。
//
// 批量模式下扣的是**真钱**：BatchUpdateTypeUserQuota 是用户余额、BatchUpdateTypeTokenQuota
// 是令牌剩余额度。InitBatchUpdater 只有一个 for{sleep;flush} 的循环，没有退出前的 flush，
// 于是每次重启（包括正常的 docker compose up -d）都会丢掉最多一个 BATCH_UPDATE_INTERVAL
// 的扣费，而消费日志早就写好了——这正是「日志 quota > 用户 used_quota」的来源。
func TestFlushBatchUpdatesPersistsPendingDeltas(t *testing.T) {
	db := setupBatchUpdateTest(t)

	addNewRecord(BatchUpdateTypeUserQuota, 1, -70)
	addNewRecord(BatchUpdateTypeUsedQuota, 1, 70)
	addNewRecord(BatchUpdateTypeRequestCount, 1, 1)
	addNewRecord(BatchUpdateTypeTokenQuota, 1, -30)
	addNewRecord(BatchUpdateTypeChannelUsedQuota, 1, 70)

	FlushBatchUpdates()

	var user User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 930, user.Quota, "用户余额必须落库")
	assert.Equal(t, 70, user.UsedQuota)
	assert.Equal(t, 1, user.RequestCount)

	var token Token
	require.NoError(t, db.First(&token, 1).Error)
	assert.Equal(t, 470, token.RemainQuota, "令牌剩余额度必须落库")

	var channel Channel
	require.NoError(t, db.First(&channel, 1).Error)
	assert.Equal(t, int64(70), channel.UsedQuota)
}

// 落库失败时不能把增量丢掉。
//
// batchUpdate 是「先把 store 换成空的，再逐条应用」，应用失败只打一行日志——
// 那笔扣费就永远消失了，而且没有任何重试。数据库抖一下 = 免费送一笔。
func TestBatchUpdateRetriesTokenDeltaAfterApplyFailure(t *testing.T) {
	db := setupBatchUpdateTest(t)

	addNewRecord(BatchUpdateTypeTokenQuota, 1, -30)
	require.NoError(t, db.Migrator().DropTable(&Token{}))

	FlushBatchUpdates()
	assert.Equal(t, 1, pendingCount(BatchUpdateTypeTokenQuota),
		"落库失败的增量必须留在缓冲区里等下一轮，不能静默丢弃")

	require.NoError(t, db.AutoMigrate(&Token{}))
	require.NoError(t, db.Create(&Token{Id: 1, UserId: 1, Name: "batch-token", Key: "batchkey00000000", RemainQuota: 500}).Error)

	FlushBatchUpdates()

	var token Token
	require.NoError(t, db.First(&token, 1).Error)
	assert.Equal(t, 470, token.RemainQuota, "下一轮必须把上一轮失败的增量补上")
	assert.Zero(t, pendingCount(BatchUpdateTypeTokenQuota))
}

func TestBatchUpdateRetriesUserDeltaAfterApplyFailure(t *testing.T) {
	db := setupBatchUpdateTest(t)

	addNewRecord(BatchUpdateTypeUserQuota, 1, -70)
	addNewRecord(BatchUpdateTypeUsedQuota, 1, 70)
	addNewRecord(BatchUpdateTypeRequestCount, 1, 1)
	require.NoError(t, db.Migrator().DropTable(&User{}))

	FlushBatchUpdates()
	assert.Equal(t, 1, pendingCount(BatchUpdateTypeUserQuota), "余额增量必须保留")
	assert.Equal(t, 1, pendingCount(BatchUpdateTypeUsedQuota))
	assert.Equal(t, 1, pendingCount(BatchUpdateTypeRequestCount))

	require.NoError(t, db.AutoMigrate(&User{}))
	require.NoError(t, db.Create(&User{Id: 1, Username: "batch-user", Quota: 1000, UsedQuota: 0}).Error)

	FlushBatchUpdates()

	var user User
	require.NoError(t, db.First(&user, 1).Error)
	assert.Equal(t, 930, user.Quota)
	assert.Equal(t, 70, user.UsedQuota)
	assert.Equal(t, 1, user.RequestCount)
	assert.Zero(t, pendingCount(BatchUpdateTypeUserQuota))
}

// 重试保留的必须是「失败的那一笔」，而不是把期间新到的增量一起吞掉或重复应用。
func TestBatchUpdateRetryAccumulatesWithNewDeltas(t *testing.T) {
	db := setupBatchUpdateTest(t)

	addNewRecord(BatchUpdateTypeChannelUsedQuota, 1, 10)
	require.NoError(t, db.Migrator().DropTable(&Channel{}))
	FlushBatchUpdates()

	// 失败期间又来了一笔
	addNewRecord(BatchUpdateTypeChannelUsedQuota, 1, 5)

	require.NoError(t, db.AutoMigrate(&Channel{}))
	require.NoError(t, db.Create(&Channel{Id: 1, Name: "batch-channel", UsedQuota: 0}).Error)
	FlushBatchUpdates()

	var channel Channel
	require.NoError(t, db.First(&channel, 1).Error)
	assert.Equal(t, int64(15), channel.UsedQuota, "失败的 10 与新来的 5 都要算上，且只算一次")
}
