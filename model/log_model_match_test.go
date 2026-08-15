package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestGetAllLogsSeparatesExactAndFuzzyModelMatches(t *testing.T) {
	previousLogDB := LOG_DB
	previousMainDatabaseType := common.MainDatabaseType()
	previousLogDatabaseType := common.LogDatabaseType()
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)

	dsn := fmt.Sprintf("file:log-model-match-%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		common.SetDatabaseTypes(previousMainDatabaseType, previousLogDatabaseType)
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	require.NoError(t, db.AutoMigrate(&Log{}))
	LOG_DB = db

	require.NoError(t, db.Create([]*Log{
		{ModelName: "gpt-5.6-sol"},
		{ModelName: "prefix-gpt-5.6-sol"},
		{ModelName: "gpt-5.6-sol-mini"},
	}).Error)

	exactLogs, exactTotal, err := GetAllLogs(
		LogTypeUnknown, 0, 0, "gpt-5.6-sol", LogModelMatchExact,
		"", "", 0, 20, 0, "", "", "",
	)
	require.NoError(t, err)
	assert.EqualValues(t, 1, exactTotal)
	require.Len(t, exactLogs, 1)
	assert.Equal(t, "gpt-5.6-sol", exactLogs[0].ModelName)

	fuzzyLogs, fuzzyTotal, err := GetAllLogs(
		LogTypeUnknown, 0, 0, "gpt-5.6-sol", LogModelMatchFuzzy,
		"", "", 0, 20, 0, "", "", "",
	)
	require.NoError(t, err)
	assert.EqualValues(t, 3, fuzzyTotal)
	assert.Len(t, fuzzyLogs, 3)
}
