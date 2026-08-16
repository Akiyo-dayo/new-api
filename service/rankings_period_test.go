package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRankingLocationUsesAsiaShanghai(t *testing.T) {
	require.Equal(t, "Asia/Shanghai", rankingLocation.String())
}

func TestRankingTimeRangeUsesNaturalShanghaiBoundaries(t *testing.T) {
	location := rankingLocation
	now := time.Date(2026, time.August, 15, 13, 45, 0, 0, location)

	for _, test := range []struct {
		period string
		want   time.Time
	}{
		{period: "today", want: time.Date(2026, time.August, 15, 0, 0, 0, 0, location)},
		{period: "week", want: time.Date(2026, time.August, 10, 0, 0, 0, 0, location)},
		{period: "month", want: time.Date(2026, time.August, 1, 0, 0, 0, 0, location)},
		{period: "year", want: time.Date(2026, time.January, 1, 0, 0, 0, 0, location)},
	} {
		t.Run(test.period, func(t *testing.T) {
			config, err := rankingConfigForMode(test.period, string(rankingModeNatural))
			require.NoError(t, err)

			start, end := rankingTimeRange(config, now)
			require.Equal(t, test.want.Unix(), start)
			require.Equal(t, now.Unix(), end)
		})
	}
}

func TestNaturalPeriodUsesShanghaiDateAcrossUTCDateBoundary(t *testing.T) {
	config, err := rankingConfigForMode("today", string(rankingModeNatural))
	require.NoError(t, err)

	now := time.Date(2026, time.August, 15, 23, 45, 0, 0, time.UTC)
	start, end := rankingTimeRange(config, now)

	require.Equal(t, time.Date(2026, time.August, 15, 16, 0, 0, 0, time.UTC).Unix(), start)
	require.Equal(t, now.Unix(), end)
}

func TestNaturalRankingBucketLabelUsesShanghaiTime(t *testing.T) {
	config, err := rankingConfigForMode("today", string(rankingModeNatural))
	require.NoError(t, err)

	bucket := time.Date(2026, time.August, 15, 16, 0, 0, 0, time.UTC).Unix()
	require.Equal(t, "00:00", rankingBucketLabel(bucket, config))
}

func TestRankingTimeRangeDefaultsToRollingWindows(t *testing.T) {
	location := rankingLocation
	now := time.Date(2026, time.August, 15, 13, 45, 0, 0, location)

	for _, test := range []struct {
		period string
		age    time.Duration
	}{
		{period: "today", age: 24 * time.Hour},
		{period: "week", age: 7 * 24 * time.Hour},
		{period: "month", age: 30 * 24 * time.Hour},
		{period: "year", age: 365 * 24 * time.Hour},
	} {
		t.Run(test.period, func(t *testing.T) {
			config, err := rankingConfig(test.period)
			require.NoError(t, err)

			start, end := rankingTimeRange(config, now)
			require.Equal(t, now.Add(-test.age).Unix(), start)
			require.Equal(t, now.Unix(), end)
		})
	}
}

func TestRankingModeNormalizesInvalidValuesAndSeparatesCacheKeys(t *testing.T) {
	rolling, err := rankingConfigForMode("today", "rolling")
	require.NoError(t, err)
	natural, err := rankingConfigForMode("today", "natural")
	require.NoError(t, err)
	invalid, err := rankingConfigForMode("today", "unknown")
	require.NoError(t, err)

	require.Equal(t, rankingModeRolling, rolling.mode)
	require.Equal(t, rankingModeNatural, natural.mode)
	require.Equal(t, rankingModeRolling, invalid.mode)
	require.NotEqual(t, rolling.cacheKey(), natural.cacheKey())
}

func TestPreviousRankingTimeRangeUsesPreviousNaturalPeriod(t *testing.T) {
	now := time.Date(2026, time.August, 15, 13, 45, 0, 0, rankingLocation)
	config, err := rankingConfigForMode("month", string(rankingModeNatural))
	require.NoError(t, err)

	start, _ := rankingTimeRange(config, now)
	previousStart, previousEnd := previousRankingTimeRange(config, start)
	require.Equal(t, time.Date(2026, time.July, 1, 0, 0, 0, 0, rankingLocation).Unix(), previousStart)
	require.Equal(t, time.Date(2026, time.August, 1, 0, 0, 0, 0, rankingLocation).Unix()-1, previousEnd)
}

func TestRankingCacheExpiresAtNaturalPeriodBoundary(t *testing.T) {
	config, err := rankingConfigForMode("today", string(rankingModeNatural))
	require.NoError(t, err)
	now := time.Date(2026, time.August, 15, 23, 59, 59, 0, rankingLocation)

	require.Equal(t, time.Date(2026, time.August, 16, 0, 0, 0, 0, rankingLocation), rankingCacheExpiresAt(config, now))
}

func TestRankingCacheExpiresByTTLForRollingMode(t *testing.T) {
	config, err := rankingConfig("today")
	require.NoError(t, err)
	now := time.Date(2026, time.August, 15, 23, 59, 59, 0, rankingLocation)

	require.Equal(t, now.Add(rankingCacheTTL), rankingCacheExpiresAt(config, now))
}
