package model

import (
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

type RankingQuotaTotal struct {
	ModelName   string `json:"model_name"`
	TotalTokens int64  `json:"total_tokens"`
}

type RankingQuotaBucket struct {
	ModelName string `json:"model_name"`
	Bucket    int64  `json:"bucket"`
	Tokens    int64  `json:"tokens"`
}

type UserSpendingTotal struct {
	UserId     int    `json:"user_id"`
	Username   string `json:"username"`
	TotalQuota int64  `json:"total_quota"`
}

func GetUserSpendingTotals(startTime int64, endTime int64) ([]UserSpendingTotal, error) {
	return getUserSpendingTotals(startTime, endTime, 0)
}

func GetUserSpendingTotalsLimited(startTime int64, endTime int64, limit int) ([]UserSpendingTotal, error) {
	return getUserSpendingTotals(startTime, endTime, limit)
}

func getUserSpendingTotals(startTime int64, endTime int64, limit int) ([]UserSpendingTotal, error) {
	var rows []UserSpendingTotal
	query := LOG_DB.Table("logs").
		Select("user_id, MAX(username) as username, COALESCE(sum(quota), 0) as total_quota").
		Where("type = ?", LogTypeConsume).
		Where("user_id > 0").
		Group("user_id").
		Having("sum(quota) > 0").
		Order("total_quota DESC, user_id ASC")
	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	if limit > 0 {
		query = query.Limit(limit)
	}
	return rows, query.Find(&rows).Error
}

func GetUserSpendingTotalQuota(startTime int64, endTime int64) (int64, error) {
	var total int64
	query := LOG_DB.Table("logs").
		Select("COALESCE(sum(quota), 0)").
		Where("type = ?", LogTypeConsume).
		Where("user_id > 0")
	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	return total, query.Scan(&total).Error
}

func GetRankingQuotaTotals(startTime int64, endTime int64) ([]RankingQuotaTotal, error) {
	var rows []RankingQuotaTotal
	query := DB.Table("quota_data").
		Select("model_name, sum(token_used) as total_tokens").
		Where("model_name <> ''").
		Group("model_name").
		Having("sum(token_used) > 0").
		Order("total_tokens DESC")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

func GetRankingQuotaBuckets(startTime int64, endTime int64, bucketSize int64) ([]RankingQuotaBucket, error) {
	if bucketSize <= 0 {
		bucketSize = 3600
	}
	bucketExpr := rankingBucketExpr(bucketSize)
	var rows []RankingQuotaBucket
	query := DB.Table("quota_data").
		Select(fmt.Sprintf("model_name, %s as bucket, sum(token_used) as tokens", bucketExpr)).
		Where("model_name <> ''").
		Group(fmt.Sprintf("model_name, %s", bucketExpr)).
		Having("sum(token_used) > 0").
		Order("bucket ASC")
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.Find(&rows).Error
	return rows, err
}

func rankingBucketExpr(bucketSize int64) string {
	if common.UsingMainDatabase(common.DatabaseTypeMySQL) {
		return fmt.Sprintf("FLOOR(created_at / %d) * %d", bucketSize, bucketSize)
	}
	return fmt.Sprintf("(created_at / %d) * %d", bucketSize, bucketSize)
}

func applyRankingQuotaTimeRange(query *gorm.DB, startTime int64, endTime int64) *gorm.DB {
	if startTime > 0 {
		query = query.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("created_at <= ?", endTime)
	}
	return query
}
