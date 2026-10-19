package model

import (
	"sort"
	"strings"
	"time"
)

const (
	// AvailabilityDefaultHours is the default statistics window.
	AvailabilityDefaultHours = 24
	// AvailabilityMaxHours caps the statistics window at 7 days.
	AvailabilityMaxHours = 168

	availabilityRecentErrorsScanLimit = 500
	availabilityRecentErrorsPerCell   = 5
	availabilityErrorContentMaxRunes  = 200
)

// AvailabilityQuery filters the availability matrix aggregation.
type AvailabilityQuery struct {
	Hours int
	Group string
	Model string
}

// AvailabilityRecentError is a single recent error log entry for a cell.
type AvailabilityRecentError struct {
	ChannelId int    `json:"channel_id,omitempty"`
	Content   string `json:"content"`
	CreatedAt int64  `json:"created_at"`
}

// AvailabilityCell holds the aggregated stats for one (group, model) pair.
type AvailabilityCell struct {
	Group         string                    `json:"group"`
	Model         string                    `json:"model"`
	Success       int64                     `json:"success"`
	Errors        int64                     `json:"errors"`
	Availability  float64                   `json:"availability"`
	LastSuccessAt int64                     `json:"last_success_at"`
	LastErrorAt   int64                     `json:"last_error_at"`
	RecentErrors  []AvailabilityRecentError `json:"recent_errors"`
}

// AvailabilityMatrix is the response payload for the availability board.
type AvailabilityMatrix struct {
	Groups      []string           `json:"groups"`
	Models      []string           `json:"models"`
	Cells       []AvailabilityCell `json:"cells"`
	WindowHours int                `json:"window_hours"`
	GeneratedAt int64              `json:"generated_at"`
}

// availabilityAggregateRow mirrors one row of the GROUP BY query.
type availabilityAggregateRow struct {
	Group         string `gorm:"column:grp"`
	ModelName     string `gorm:"column:model_name"`
	Success       int64  `gorm:"column:success"`
	Errors        int64  `gorm:"column:errors"`
	LastSuccessAt int64  `gorm:"column:last_success_at"`
	LastErrorAt   int64  `gorm:"column:last_error_at"`
}

// availabilityErrorLog mirrors one row of the recent-error scan.
type availabilityErrorLog struct {
	Id        int    `gorm:"column:id"`
	Group     string `gorm:"column:grp"`
	ModelName string `gorm:"column:model_name"`
	ChannelId int    `gorm:"column:channel_id"`
	Content   string `gorm:"column:content"`
	CreatedAt int64  `gorm:"column:created_at"`
}

func availabilityGroupCol() string {
	if logGroupCol != "" {
		return logGroupCol
	}
	// InitColumnNames has not run yet (e.g. unit tests); MySQL/SQLite quoting.
	return "`group`"
}

// GetAvailabilityMatrix aggregates consume/error logs into a group x model
// availability matrix for the given window.
func GetAvailabilityMatrix(query AvailabilityQuery) (*AvailabilityMatrix, error) {
	hours := query.Hours
	if hours <= 0 {
		hours = AvailabilityDefaultHours
	}
	if hours > AvailabilityMaxHours {
		hours = AvailabilityMaxHours
	}
	since := time.Now().Unix() - int64(hours)*3600
	groupCol := availabilityGroupCol()

	baseWhere := "type IN (?, ?) AND created_at >= ? AND model_name <> ''"
	baseArgs := []any{LogTypeConsume, LogTypeError, since}
	if query.Group != "" {
		baseWhere += " AND " + groupCol + " = ?"
		baseArgs = append(baseArgs, query.Group)
	}
	if query.Model != "" {
		baseWhere += " AND model_name = ?"
		baseArgs = append(baseArgs, query.Model)
	}

	aggregateSQL := "SELECT " + groupCol + " AS grp, model_name, " +
		"SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS success, " +
		"SUM(CASE WHEN type = ? THEN 1 ELSE 0 END) AS errors, " +
		"COALESCE(MAX(CASE WHEN type = ? THEN created_at END), 0) AS last_success_at, " +
		"COALESCE(MAX(CASE WHEN type = ? THEN created_at END), 0) AS last_error_at " +
		"FROM logs WHERE " + baseWhere + " GROUP BY " + groupCol + ", model_name"
	aggregateArgs := append([]any{LogTypeConsume, LogTypeError, LogTypeConsume, LogTypeError}, baseArgs...)

	var rows []availabilityAggregateRow
	if err := LOG_DB.Raw(aggregateSQL, aggregateArgs...).Scan(&rows).Error; err != nil {
		return nil, err
	}

	errorWhere := "type = ? AND created_at >= ? AND model_name <> ''"
	errorArgs := []any{LogTypeError, since}
	if query.Group != "" {
		errorWhere += " AND " + groupCol + " = ?"
		errorArgs = append(errorArgs, query.Group)
	}
	if query.Model != "" {
		errorWhere += " AND model_name = ?"
		errorArgs = append(errorArgs, query.Model)
	}

	var errorLogs []availabilityErrorLog
	if err := LOG_DB.Table("logs").
		Select("id, "+groupCol+" AS grp, model_name, channel_id, content, created_at").
		Where(errorWhere, errorArgs...).
		Order("created_at desc").
		Limit(availabilityRecentErrorsScanLimit).
		Find(&errorLogs).Error; err != nil {
		return nil, err
	}

	matrix := buildAvailabilityMatrix(rows, errorLogs, hours, time.Now().Unix())
	return &matrix, nil
}

// buildAvailabilityMatrix is a pure function combining aggregate rows with
// recent error logs; kept separate for unit testing.
func buildAvailabilityMatrix(rows []availabilityAggregateRow, errorLogs []availabilityErrorLog, hours int, generatedAt int64) AvailabilityMatrix {
	groupSet := make(map[string]struct{})
	modelSet := make(map[string]struct{})
	cells := make([]AvailabilityCell, 0, len(rows))
	cellIndex := make(map[string]int, len(rows))

	for _, row := range rows {
		if row.ModelName == "" {
			continue
		}
		total := row.Success + row.Errors
		if total == 0 {
			continue
		}
		groupSet[row.Group] = struct{}{}
		modelSet[row.ModelName] = struct{}{}
		cellIndex[row.Group+"\x00"+row.ModelName] = len(cells)
		cells = append(cells, AvailabilityCell{
			Group:         row.Group,
			Model:         row.ModelName,
			Success:       row.Success,
			Errors:        row.Errors,
			Availability:  float64(row.Success) / float64(total),
			LastSuccessAt: row.LastSuccessAt,
			LastErrorAt:   row.LastErrorAt,
			RecentErrors:  []AvailabilityRecentError{},
		})
	}

	// errorLogs are ordered by created_at desc; keep the first N per cell.
	for _, entry := range errorLogs {
		if entry.ModelName == "" {
			continue
		}
		idx, ok := cellIndex[entry.Group+"\x00"+entry.ModelName]
		if !ok {
			continue
		}
		cell := &cells[idx]
		if len(cell.RecentErrors) >= availabilityRecentErrorsPerCell {
			continue
		}
		cell.RecentErrors = append(cell.RecentErrors, AvailabilityRecentError{
			ChannelId: entry.ChannelId,
			Content:   truncateRunes(entry.Content, availabilityErrorContentMaxRunes),
			CreatedAt: entry.CreatedAt,
		})
	}

	groups := make([]string, 0, len(groupSet))
	for g := range groupSet {
		groups = append(groups, g)
	}
	sort.Strings(groups)
	models := make([]string, 0, len(modelSet))
	for m := range modelSet {
		models = append(models, m)
	}
	sort.Strings(models)

	return AvailabilityMatrix{
		Groups:      groups,
		Models:      models,
		Cells:       cells,
		WindowHours: hours,
		GeneratedAt: generatedAt,
	}
}

func truncateRunes(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes]) + "…"
}
