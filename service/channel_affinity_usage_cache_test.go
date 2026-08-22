package service

import (
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type channelAffinityStatsFixture struct {
	ctx        *gin.Context
	ruleName   string
	usingGroup string
	keyFP      string
}

func buildChannelAffinityStatsFixture(t *testing.T) channelAffinityStatsFixture {
	t.Helper()
	fixture := channelAffinityStatsFixture{
		ruleName:   t.Name(),
		usingGroup: "default",
		keyFP:      fmt.Sprintf("fp:%s", t.Name()),
	}
	rec := httptest.NewRecorder()
	fixture.ctx, _ = gin.CreateTestContext(rec)
	setChannelAffinityContext(fixture.ctx, channelAffinityMeta{
		CacheKey:       fmt.Sprintf("test:%s:%s:%s", fixture.ruleName, fixture.usingGroup, fixture.keyFP),
		TTLSeconds:     600,
		RuleName:       fixture.ruleName,
		UsingGroup:     fixture.usingGroup,
		KeyFingerprint: fixture.keyFP,
	})
	fixture.reset(t)
	t.Cleanup(func() { fixture.reset(t) })
	return fixture
}

func (f channelAffinityStatsFixture) stats() ChannelAffinityUsageCacheStats {
	return GetChannelAffinityUsageCacheStats(f.ruleName, f.usingGroup, f.keyFP)
}

func (f channelAffinityStatsFixture) reset(t *testing.T) {
	t.Helper()
	entryKey := channelAffinityUsageCacheEntryKey(f.ruleName, f.usingGroup, f.keyFP)
	_, err := getChannelAffinityUsageCacheStatsCache().DeleteMany([]string{entryKey})
	require.NoError(t, err)
}

func TestObserveChannelAffinityUsageCacheByRelayFormat_ClaudeMode(t *testing.T) {
	fixture := buildChannelAffinityStatsFixture(t)

	usage := &dto.Usage{
		PromptTokens:     100,
		CompletionTokens: 40,
		TotalTokens:      140,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 30,
		},
	}

	ObserveChannelAffinityUsageCacheByRelayFormat(fixture.ctx, usage, types.RelayFormatClaude)
	stats := fixture.stats()

	require.EqualValues(t, 1, stats.Total)
	require.EqualValues(t, 1, stats.Hit)
	require.EqualValues(t, 100, stats.PromptTokens)
	require.EqualValues(t, 40, stats.CompletionTokens)
	require.EqualValues(t, 140, stats.TotalTokens)
	require.EqualValues(t, 30, stats.CachedTokens)
	require.Equal(t, cacheTokenRateModeCachedOverPromptPlusCached, stats.CachedTokenRateMode)
}

func TestObserveChannelAffinityUsageCacheByRelayFormat_MixedMode(t *testing.T) {
	fixture := buildChannelAffinityStatsFixture(t)

	openAIUsage := &dto.Usage{
		PromptTokens: 100,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 10,
		},
	}
	claudeUsage := &dto.Usage{
		PromptTokens: 80,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 20,
		},
	}

	ObserveChannelAffinityUsageCacheByRelayFormat(fixture.ctx, openAIUsage, types.RelayFormatOpenAI)
	ObserveChannelAffinityUsageCacheByRelayFormat(fixture.ctx, claudeUsage, types.RelayFormatClaude)
	stats := fixture.stats()

	require.EqualValues(t, 2, stats.Total)
	require.EqualValues(t, 2, stats.Hit)
	require.EqualValues(t, 180, stats.PromptTokens)
	require.EqualValues(t, 30, stats.CachedTokens)
	require.Equal(t, cacheTokenRateModeMixed, stats.CachedTokenRateMode)
}

func TestObserveChannelAffinityUsageCacheByRelayFormat_UnsupportedModeKeepsEmpty(t *testing.T) {
	fixture := buildChannelAffinityStatsFixture(t)

	usage := &dto.Usage{
		PromptTokens: 100,
		PromptTokensDetails: dto.InputTokenDetails{
			CachedTokens: 25,
		},
	}

	ObserveChannelAffinityUsageCacheByRelayFormat(fixture.ctx, usage, types.RelayFormatGemini)
	stats := fixture.stats()

	require.EqualValues(t, 1, stats.Total)
	require.EqualValues(t, 1, stats.Hit)
	require.EqualValues(t, 25, stats.CachedTokens)
	require.Equal(t, "", stats.CachedTokenRateMode)
}
