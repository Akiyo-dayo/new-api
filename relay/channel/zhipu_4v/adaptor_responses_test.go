package zhipu_4v

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestConvertOpenAIResponsesRequestPreservesToolsAndToolResults(t *testing.T) {
	maxOutputTokens := uint(128)
	converted := mustConvertResponsesToZhipuV4(t, dto.OpenAIResponsesRequest{
		Model: "glm-5.2",
		Input: mustZhipuV4Raw(t, []map[string]any{
			{"role": "user", "content": "What is the weather in Tokyo?"},
			{"type": "function_call", "call_id": "call_1", "name": "get_weather", "arguments": `{"city":"Tokyo"}`},
			{"type": "function_call_output", "call_id": "call_1", "output": `{"temperature_c":26}`},
		}),
		Tools: mustZhipuV4Raw(t, []map[string]any{{
			"type": "function", "name": "get_weather", "description": "Get weather",
			"parameters": map[string]any{"type": "object", "properties": map[string]any{"city": map[string]any{"type": "string"}}},
		}}),
		ToolChoice:      mustZhipuV4Raw(t, map[string]any{"type": "function", "name": "get_weather"}),
		MaxOutputTokens: &maxOutputTokens,
	})

	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.Equal(t, "glm-5.2", gjson.GetBytes(body, "model").String())
	assert.Equal(t, int64(128), gjson.GetBytes(body, "max_tokens").Int())
	assert.Equal(t, "get_weather", gjson.GetBytes(body, "tools.0.function.name").String())
	assert.Equal(t, "get_weather", gjson.GetBytes(body, "tool_choice.function.name").String())
	assert.Equal(t, "get_weather", gjson.GetBytes(body, `messages.#(role=="assistant").tool_calls.0.function.name`).String())
	assert.Equal(t, "call_1", gjson.GetBytes(body, `messages.#(role=="tool").tool_call_id`).String())
}

func TestConvertOpenAIResponsesRequestPreservesImageAndNormalizesTopP(t *testing.T) {
	topP := 1.0
	converted := mustConvertResponsesToZhipuV4(t, dto.OpenAIResponsesRequest{
		Model: "glm-5.2",
		Input: mustZhipuV4Raw(t, []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{"type": "input_text", "text": "Describe this image"},
				{"type": "input_image", "image_url": "data:image/png;base64,AAAA"},
			},
		}}),
		TopP: &topP,
	})

	body, err := common.Marshal(converted)
	require.NoError(t, err)
	assert.InDelta(t, 0.99, gjson.GetBytes(body, "top_p").Float(), 0.000001)
	assert.Equal(t, "AAAA", gjson.GetBytes(body, "messages.0.content.1.image_url.url").String())
}

func mustConvertResponsesToZhipuV4(t *testing.T, request dto.OpenAIResponsesRequest) *dto.GeneralOpenAIRequest {
	t.Helper()
	info := &relaycommon.RelayInfo{
		OriginModelName: request.Model,
		ChannelMeta:     &relaycommon.ChannelMeta{UpstreamModelName: request.Model},
	}
	converted, err := (&Adaptor{}).ConvertOpenAIResponsesRequest(nil, info, request)
	require.NoError(t, err)
	chatRequest, ok := converted.(*dto.GeneralOpenAIRequest)
	require.True(t, ok)
	return chatRequest
}

func mustZhipuV4Raw(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := common.Marshal(value)
	require.NoError(t, err)
	return raw
}
