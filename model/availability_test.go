package model

import (
	"strings"
	"testing"
	"time"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestBuildAvailabilityMatrix(t *testing.T) {
	rows := []availabilityAggregateRow{
		{Group: "vip", ModelName: "gpt-x", Success: 99, Errors: 1, LastSuccessAt: 1000, LastErrorAt: 900},
		{Group: "default", ModelName: "gpt-x", Success: 3, Errors: 7, LastSuccessAt: 800, LastErrorAt: 950},
		{Group: "default", ModelName: "", Success: 5, Errors: 0},                    // ignored: empty model
		{Group: "empty", ModelName: "ghost", Success: 0, Errors: 0},                 // ignored: no traffic
		{Group: "vip", ModelName: "claude-y", Success: 50, Errors: 50, LastErrorAt: 700},
	}
	longContent := strings.Repeat("错", 300)
	errorLogs := []availabilityErrorLog{
		{Group: "default", ModelName: "gpt-x", ChannelId: 7, Content: "latest", CreatedAt: 950},
		{Group: "default", ModelName: "gpt-x", ChannelId: 7, Content: "e4", CreatedAt: 940},
		{Group: "default", ModelName: "gpt-x", ChannelId: 8, Content: "e3", CreatedAt: 930},
		{Group: "default", ModelName: "gpt-x", ChannelId: 8, Content: "e2", CreatedAt: 920},
		{Group: "default", ModelName: "gpt-x", ChannelId: 9, Content: "e1", CreatedAt: 910},
		{Group: "default", ModelName: "gpt-x", ChannelId: 9, Content: "dropped", CreatedAt: 900},
		{Group: "vip", ModelName: "gpt-x", ChannelId: 3, Content: longContent, CreatedAt: 900},
		{Group: "unknown", ModelName: "not-in-cells", ChannelId: 1, Content: "x", CreatedAt: 100},
	}

	matrix := buildAvailabilityMatrix(rows, errorLogs, 24, 123456)

	assert.Equal(t, []string{"default", "vip"}, matrix.Groups)
	assert.Equal(t, []string{"claude-y", "gpt-x"}, matrix.Models)
	assert.Equal(t, 24, matrix.WindowHours)
	assert.Equal(t, int64(123456), matrix.GeneratedAt)
	require.Len(t, matrix.Cells, 3)

	byKey := make(map[string]AvailabilityCell)
	for _, cell := range matrix.Cells {
		byKey[cell.Group+"/"+cell.Model] = cell
	}

	vip := byKey["vip/gpt-x"]
	assert.Equal(t, int64(99), vip.Success)
	assert.Equal(t, int64(1), vip.Errors)
	assert.InDelta(t, 0.99, vip.Availability, 1e-9)
	assert.Equal(t, int64(1000), vip.LastSuccessAt)
	assert.Equal(t, int64(900), vip.LastErrorAt)
	require.Len(t, vip.RecentErrors, 1)
	assert.LessOrEqual(t, len([]rune(vip.RecentErrors[0].Content)), availabilityErrorContentMaxRunes+1)
	assert.True(t, strings.HasSuffix(vip.RecentErrors[0].Content, "…"))

	def := byKey["default/gpt-x"]
	assert.InDelta(t, 0.3, def.Availability, 1e-9)
	require.Len(t, def.RecentErrors, availabilityRecentErrorsPerCell)
	assert.Equal(t, "latest", def.RecentErrors[0].Content)
	assert.Equal(t, "e1", def.RecentErrors[4].Content)

	half := byKey["vip/claude-y"]
	assert.InDelta(t, 0.5, half.Availability, 1e-9)
	assert.Empty(t, half.RecentErrors)
}

func TestTruncateRunes(t *testing.T) {
	assert.Equal(t, "abc", truncateRunes("abc", 10))
	assert.Equal(t, "ab…", truncateRunes("abcd", 2))
	assert.Equal(t, "你好…", truncateRunes("你好世界", 2))
}

func setupAvailabilityTestDB(t *testing.T) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		type INTEGER NOT NULL,
		model_name TEXT NOT NULL DEFAULT '',
		`+"`group`"+` TEXT NOT NULL DEFAULT '',
		channel_id INTEGER NOT NULL DEFAULT 0,
		content TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL DEFAULT 0
	)`).Error)

	previousLogDB := LOG_DB
	previousGroupCol := logGroupCol
	LOG_DB = db
	logGroupCol = "`group`"
	t.Cleanup(func() {
		LOG_DB = previousLogDB
		logGroupCol = previousGroupCol
	})
}

func TestGetAvailabilityMatrixSQLite(t *testing.T) {
	setupAvailabilityTestDB(t)

	now := time.Now().Unix()
	insert := func(logType int, model, group string, channelId int, content string, createdAt int64) {
		require.NoError(t, LOG_DB.Exec(
			"INSERT INTO logs (type, model_name, `group`, channel_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)",
			logType, model, group, channelId, content, createdAt,
		).Error)
	}

	// Inside the default 24h window.
	insert(LogTypeConsume, "gpt-x", "vip", 1, "", now-100)
	insert(LogTypeConsume, "gpt-x", "vip", 1, "", now-200)
	insert(LogTypeError, "gpt-x", "vip", 2, "upstream timeout", now-50)
	insert(LogTypeConsume, "gpt-x", "default", 3, "", now-300)
	insert(LogTypeError, "gpt-x", "default", 3, "channel disabled", now-60)
	insert(LogTypeError, "claude-y", "default", 4, "model not found", now-70)
	// Outside the window: must be excluded.
	insert(LogTypeConsume, "gpt-x", "vip", 1, "", now-100*3600)
	// Empty model name: must be excluded.
	insert(LogTypeError, "", "vip", 1, "no model", now-10)
	// Irrelevant log types: must be excluded.
	insert(LogTypeManage, "gpt-x", "vip", 1, "", now-10)

	matrix, err := GetAvailabilityMatrix(AvailabilityQuery{Hours: 0})
	require.NoError(t, err)
	assert.Equal(t, AvailabilityDefaultHours, matrix.WindowHours)
	require.Len(t, matrix.Cells, 3)

	byKey := make(map[string]AvailabilityCell)
	for _, cell := range matrix.Cells {
		byKey[cell.Group+"/"+cell.Model] = cell
	}
	vip := byKey["vip/gpt-x"]
	assert.Equal(t, int64(2), vip.Success)
	assert.Equal(t, int64(1), vip.Errors)
	assert.InDelta(t, 2.0/3.0, vip.Availability, 1e-9)
	require.Len(t, vip.RecentErrors, 1)
	assert.Equal(t, 2, vip.RecentErrors[0].ChannelId)
	assert.Equal(t, "upstream timeout", vip.RecentErrors[0].Content)

	claude := byKey["default/claude-y"]
	assert.Equal(t, int64(0), claude.Success)
	assert.Equal(t, int64(1), claude.Errors)
	assert.InDelta(t, 0.0, claude.Availability, 1e-9)

	// Group filter.
	filtered, err := GetAvailabilityMatrix(AvailabilityQuery{Hours: 24, Group: "vip"})
	require.NoError(t, err)
	require.Len(t, filtered.Cells, 1)
	assert.Equal(t, "vip", filtered.Cells[0].Group)

	// Model filter.
	filtered, err = GetAvailabilityMatrix(AvailabilityQuery{Hours: 24, Model: "claude-y"})
	require.NoError(t, err)
	require.Len(t, filtered.Cells, 1)
	assert.Equal(t, "claude-y", filtered.Cells[0].Model)

	// Hours clamping.
	filtered, err = GetAvailabilityMatrix(AvailabilityQuery{Hours: 10000})
	require.NoError(t, err)
	assert.Equal(t, AvailabilityMaxHours, filtered.WindowHours)
}
