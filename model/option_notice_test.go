package model

import (
	"fmt"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestUpdateOptionAdvancesNoticeVersionOnlyWhenContentChanges(t *testing.T) {
	previousDB := DB
	previousOptions := common.OptionMap
	t.Cleanup(func() {
		DB = previousDB
		common.OptionMap = previousOptions
	})

	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:notice-version-test-%s?mode=memory&cache=shared", common.GetRandomString(8))), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	common.OptionMap = make(map[string]string)
	require.NoError(t, db.AutoMigrate(&Option{}))

	require.NoError(t, UpdateOption("Notice", "A"))
	require.Equal(t, "1", common.OptionMap[noticeVersionOptionKey])
	require.NoError(t, UpdateOption("Notice", "A"))
	require.Equal(t, "1", common.OptionMap[noticeVersionOptionKey])
	require.NoError(t, UpdateOption("Notice", "B"))
	require.Equal(t, "2", common.OptionMap[noticeVersionOptionKey])
	require.NoError(t, UpdateOption("Notice", "A"))
	require.Equal(t, "3", common.OptionMap[noticeVersionOptionKey])
}
