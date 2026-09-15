package openai

import (
	"net/http/httptest"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func withThinkingBlacklist(t *testing.T, extra ...string) {
	t.Helper()
	origin := model_setting.GetGlobalSettings().ThinkingModelBlacklist
	model_setting.GetGlobalSettings().ThinkingModelBlacklist = append(append([]string{}, origin...), extra...)
	t.Cleanup(func() {
		model_setting.GetGlobalSettings().ThinkingModelBlacklist = origin
	})
}

func newResponsesTestContext() *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	return c
}

func newResponsesRelayInfo(origin, upstream string) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		OriginModelName: origin,
		ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: upstream},
	}
}

// 映射后的上游模型名是真实 ID（如 gemini-3.8-flash-high），命中黑名单时必须整体保留，
// 不能被当成 reasoning effort 后缀剥掉。
func TestConvertOpenAIResponsesRequestPreservesBlacklistedUpstreamSuffix(t *testing.T) {
	withThinkingBlacklist(t, "gemini-3.8-flash-high")

	adaptor := &Adaptor{}
	info := newResponsesRelayInfo("gemini-3.8-flash", "gemini-3.8-flash-high")
	req := dto.OpenAIResponsesRequest{Model: "gemini-3.8-flash-high"}

	out, err := adaptor.ConvertOpenAIResponsesRequest(newResponsesTestContext(), info, req)
	require.NoError(t, err)
	got := out.(dto.OpenAIResponsesRequest)
	assert.Equal(t, "gemini-3.8-flash-high", got.Model)
	assert.Nil(t, got.Reasoning)
	assert.Equal(t, "gemini-3.8-flash-high", info.UpstreamModelName)
}

// 客户端直连的模型名命中黑名单同样保留。
func TestConvertOpenAIResponsesRequestPreservesBlacklistedOriginName(t *testing.T) {
	withThinkingBlacklist(t, "kimi-k2-thinking-high")

	adaptor := &Adaptor{}
	info := newResponsesRelayInfo("kimi-k2-thinking-high", "kimi-k2-thinking-high")
	req := dto.OpenAIResponsesRequest{Model: "kimi-k2-thinking-high"}

	out, err := adaptor.ConvertOpenAIResponsesRequest(newResponsesTestContext(), info, req)
	require.NoError(t, err)
	got := out.(dto.OpenAIResponsesRequest)
	assert.Equal(t, "kimi-k2-thinking-high", got.Model)
	assert.Nil(t, got.Reasoning)
}

// 未命中黑名单时维持原行为：剥后缀、写 reasoning.effort，并同步 UpstreamModelName。
func TestConvertOpenAIResponsesRequestStripsReasoningSuffix(t *testing.T) {
	adaptor := &Adaptor{}
	info := newResponsesRelayInfo("o4-mini-high", "o4-mini-high")
	req := dto.OpenAIResponsesRequest{Model: "o4-mini-high"}

	out, err := adaptor.ConvertOpenAIResponsesRequest(newResponsesTestContext(), info, req)
	require.NoError(t, err)
	got := out.(dto.OpenAIResponsesRequest)
	assert.Equal(t, "o4-mini", got.Model)
	require.NotNil(t, got.Reasoning)
	assert.Equal(t, "high", got.Reasoning.Effort)
	assert.Equal(t, "o4-mini", info.UpstreamModelName)
	assert.Equal(t, "high", info.ReasoningEffort)
}
