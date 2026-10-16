package vertex

import (
	"net/url"
	"testing"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAPIKeyProjectIDPreservesRegionalAndExpressURLs(t *testing.T) {
	for _, tc := range []struct {
		name, project string
		mode          int
		model, suffix string
	}{
		{"Gemini regional", " validation-project ", RequestModeGemini, "gemini-test", ":generateContent"},
		{"Gemini streaming", "validation-project", RequestModeGemini, "gemini-test", ":streamGenerateContent?alt=sse"},
		{"Claude regional", "validation-project", RequestModeClaude, "claude-test", ":rawPredict"},
		{"Express unchanged", "", RequestModeGemini, "gemini-test", ":generateContent"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := Adaptor{RequestMode: tc.mode}
			info := &relaycommon.RelayInfo{OriginModelName: tc.model, ChannelMeta: &relaycommon.ChannelMeta{}}
			info.ApiKey = "local-test-key"
			info.ApiVersion = `{"default":"us-central1"}`
			info.ChannelOtherSettings = dto.ChannelOtherSettings{VertexKeyType: dto.VertexKeyTypeAPIKey, VertexProjectID: tc.project}
			raw, err := a.getRequestUrl(info, tc.model, tc.suffix)
			require.NoError(t, err)
			u, err := url.Parse(raw)
			require.NoError(t, err)
			assert.Equal(t, "local-test-key", u.Query().Get("key"))
			if tc.project != "" {
				assert.Contains(t, u.Path, "/projects/validation-project/locations/us-central1/")
			} else {
				assert.NotContains(t, u.Path, "/projects/")
			}
			if tc.name == "Gemini streaming" {
				assert.Equal(t, "sse", u.Query().Get("alt"))
			}
		})
	}
}
