package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 内置预设不是真实渠道，其取价地址只有唯一正确取值，必须由后端强制覆盖客户端传来的
// base_url/endpoint。这里钉住的是覆盖必须发生，而不是某个具体字面量。
func TestPresetUpstreamAddressCoversBuiltInPresets(t *testing.T) {
	tests := []struct {
		name       string
		id         int
		wantPreset bool
	}{
		{name: "official ratio preset", id: officialRatioPresetID, wantPreset: true},
		{name: "models.dev preset", id: modelsDevPresetID, wantPreset: true},
		{name: "real channel", id: 1, wantPreset: false},
		{name: "unassigned negative id", id: -1, wantPreset: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			baseURL, endpoint, isPreset := presetUpstreamAddress(tc.id)
			require.Equal(t, tc.wantPreset, isPreset)

			if !tc.wantPreset {
				assert.Empty(t, baseURL)
				assert.Empty(t, endpoint)
				return
			}

			assert.NotEmpty(t, baseURL)
			// 端点为空会在 FetchUpstreamRatios 里退回 defaultEndpoint，
			// 拼出预设站点上不存在的 /api/pricing，同步结果是 404 + 零条差异。
			assert.NotEmpty(t, endpoint)
			assert.NotEqual(t, defaultEndpoint, endpoint)
		})
	}
}

// models.dev 的 api.json 是 provider -> model 的价格树，只有走 convertModelsDevToRatioData
// 才能解析；预设地址除了要能拼出 URL，还必须仍然命中该分支。
func TestModelsDevPresetAddressRoutesToModelsDevParser(t *testing.T) {
	baseURL, endpoint, isPreset := presetUpstreamAddress(modelsDevPresetID)
	require.True(t, isPreset)
	assert.True(t, isModelsDevAPIEndpoint(baseURL+endpoint))
}
