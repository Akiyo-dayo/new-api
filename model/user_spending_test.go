package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupUserSpendingTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	previousLogDB := LOG_DB
	previousMainType := common.MainDatabaseType()
	previousLogType := common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	LOG_DB = db
	require.NoError(t, db.AutoMigrate(&Log{}))
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainType, previousLogType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	return db
}

func TestGetUserSpendingTotalsAggregatesConsumeQuotaByUser(t *testing.T) {
	db := setupUserSpendingTestDB(t)
	require.NoError(t, db.Create([]*Log{
		{UserId: 1, Username: "alice", CreatedAt: 100, Type: LogTypeConsume, Quota: 120},
		{UserId: 1, Username: "alice", CreatedAt: 200, Type: LogTypeConsume, Quota: 30},
		{UserId: 2, Username: "bob", CreatedAt: 150, Type: LogTypeConsume, Quota: 200},
		{UserId: 3, Username: "carol", CreatedAt: 175, Type: LogTypeError, Quota: 999},
	}).Error)

	rows, err := GetUserSpendingTotals(100, 200)

	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.Equal(t, 2, rows[0].UserId)
	require.Equal(t, int64(200), rows[0].TotalQuota)
	require.Equal(t, 1, rows[1].UserId)
	require.Equal(t, int64(150), rows[1].TotalQuota)

	total, err := GetUserSpendingTotalQuota(100, 200)
	require.NoError(t, err)
	require.Equal(t, int64(350), total)
}

func TestGetUserSpendingTotalsLimitedReturnsTopUsers(t *testing.T) {
	db := setupUserSpendingTestDB(t)
	for userID := 1; userID <= 3; userID++ {
		require.NoError(t, db.Create(&Log{
			UserId:    userID,
			Username:  fmt.Sprintf("user-%d", userID),
			CreatedAt: 100,
			Type:      LogTypeConsume,
			Quota:     userID * 100,
		}).Error)
	}

	rows, err := GetUserSpendingTotalsLimited(100, 100, 2)

	require.NoError(t, err)
	require.Len(t, rows, 2)
	require.Equal(t, 3, rows[0].UserId)
	require.Equal(t, 2, rows[1].UserId)
}
