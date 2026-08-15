package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestRankingTimeRangeUsesNaturalUTCBoundaries(t *testing.T) {
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
			config, err := rankingConfig(test.period)
			require.NoError(t, err)

			start, end := rankingTimeRange(config, now)
			require.Equal(t, test.want.Unix(), start)
			require.Equal(t, now.Unix(), end)
		})
	}
}

func TestPreviousRankingTimeRangeUsesPreviousNaturalPeriod(t *testing.T) {
	now := time.Date(2026, time.August, 15, 13, 45, 0, 0, rankingLocation)
	config, err := rankingConfig("month")
	require.NoError(t, err)

	start, _ := rankingTimeRange(config, now)
	previousStart, previousEnd := previousRankingTimeRange(config, start)
	require.Equal(t, time.Date(2026, time.July, 1, 0, 0, 0, 0, rankingLocation).Unix(), previousStart)
	require.Equal(t, time.Date(2026, time.August, 1, 0, 0, 0, 0, rankingLocation).Unix()-1, previousEnd)
}

func TestRankingCacheExpiresAtNaturalPeriodBoundary(t *testing.T) {
	config, err := rankingConfig("today")
	require.NoError(t, err)
	now := time.Date(2026, time.August, 15, 23, 59, 59, 0, rankingLocation)

	require.Equal(t, time.Date(2026, time.August, 16, 0, 0, 0, 0, rankingLocation), rankingCacheExpiresAt(config, now))
}
