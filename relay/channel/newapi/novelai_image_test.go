package newapi

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"time"

	"github.com/QuantumNous/new-api/service"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNAILiveUpstream(t *testing.T) {
	base, key := os.Getenv("NAI_TEST_BASE_URL"), os.Getenv("NAI_TEST_API_KEY")
	if base == "" || key == "" {
		t.Skip("explicit live NAI credentials are not configured")
	}
	service.InitHttpClient()
	for _, model := range []string{"nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-4-5-full"} {
		t.Run(model, func(t *testing.T) {
			info, request := naiFixture()
			request.Model = model
			info.UpstreamModelName = model
			info.ChannelBaseUrl = base
			info.ApiKey = key
			info.PriceData.UsePrice = true
			a := &Adaptor{}
			a.Init(info)
			converted, err := a.ConvertImageRequest(nil, info, *request)
			require.NoError(t, err)
			raw, err := common.Marshal(converted)
			require.NoError(t, err)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
			defer cancel()
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewReader(raw)).WithContext(ctx)
			c.Request.Header.Set("Content-Type", "application/json")
			start := time.Now()
			response, err := a.DoRequest(c, info, bytes.NewReader(raw))
			require.NoError(t, err)
			resp := response.(*http.Response)
			require.Equal(t, 200, resp.StatusCode)
			_, apiErr := a.DoResponse(c, resp, info)
			require.Nil(t, apiErr)
			var result struct {
				Data []struct {
					B64 string `json:"b64_json"`
				} `json:"data"`
			}
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
			require.Len(t, result.Data, 1)
			pngBytes, err := base64.StdEncoding.DecodeString(result.Data[0].B64)
			require.NoError(t, err)
			cfg, err := png.DecodeConfig(bytes.NewReader(pngBytes))
			require.NoError(t, err)
			assert.Equal(t, 512, cfg.Width)
			assert.Equal(t, 512, cfg.Height)
			assert.Equal(t, float64(1), info.PriceData.OtherRatios()["n"])
			t.Logf("native adapter HTTP200 -> OpenAI JSON -> verified PNG %dx%d, bytes=%d elapsed=%s", cfg.Width, cfg.Height, len(pngBytes), time.Since(start).Round(time.Millisecond))
		})
	}
}

func TestNAICancelledRequestDoesNotSubmit(t *testing.T) {
	service.InitHttpClient()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer server.Close()
	info, request := naiFixture()
	info.ChannelBaseUrl = server.URL
	a := &Adaptor{}
	a.Init(info)
	converted, err := a.ConvertImageRequest(nil, info, *request)
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil).WithContext(ctx)
	_, err = a.DoRequest(c, info, bytes.NewReader(body))
	require.Error(t, err)
	assert.Zero(t, calls)
}

func naiFixture() (*relaycommon.RelayInfo, *dto.ImageRequest) {
	request := &dto.ImageRequest{Model: "nai-diffusion-5-full", Prompt: "a red apple", Size: "512x512", N: common.GetPointer(uint(1)), ResponseFormat: "b64_json"}
	info := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeNewAPI, UpstreamModelName: request.Model, ChannelOtherSettings: dto.ChannelOtherSettings{NovelAINativeImages: true}}, RelayMode: relayconstant.RelayModeImagesGenerations, Request: request}
	return info, request
}

func naiZIP(t *testing.T, entries map[string][]byte) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for name, data := range entries {
		f, err := w.Create(name)
		require.NoError(t, err)
		_, err = f.Write(data)
		require.NoError(t, err)
	}
	require.NoError(t, w.Close())
	return b.Bytes()
}

func TestNAINativeConversion(t *testing.T) {
	for _, model := range []string{"nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated"} {
		t.Run(model, func(t *testing.T) {
			info, request := naiFixture()
			request.Model = model
			info.UpstreamModelName = model
			request.N = common.GetPointer(uint(2))
			request.Extra = map[string]json.RawMessage{"parameters": json.RawMessage(`{"seed":0,"cfg_rescale":0,"scale":0,"steps":12}`)}
			converted, err := convertNAIImage(info, *request)
			require.NoError(t, err)
			native := converted.(naiImageRequest)
			assert.Equal(t, model, native.Model)
			assert.Equal(t, "generate", native.Action)
			assert.Equal(t, 2, native.Parameters.NSamples)
			assert.Equal(t, 512, native.Parameters.Width)
			require.NotNil(t, native.Parameters.Seed)
			assert.Zero(t, *native.Parameters.Seed)
			assert.Zero(t, *native.Parameters.Scale)
			raw, err := common.Marshal(native)
			require.NoError(t, err)
			_, err = validateNAIOutbound(info, bytes.NewReader(raw))
			require.NoError(t, err)
			native.Parameters.NSamples = 3
			raw, err = common.Marshal(native)
			require.NoError(t, err)
			_, err = validateNAIOutbound(info, bytes.NewReader(raw))
			require.Error(t, err)
		})
	}
}

func TestNAIRejectUnsafeRequests(t *testing.T) {
	tests := []struct {
		name   string
		change func(*relaycommon.RelayInfo, *dto.ImageRequest)
	}{
		{"oversized count", func(_ *relaycommon.RelayInfo, r *dto.ImageRequest) { r.N = common.GetPointer(uint(dto.MaxImageN + 1)) }},
		{"nested quantity", func(_ *relaycommon.RelayInfo, r *dto.ImageRequest) {
			r.Extra = map[string]json.RawMessage{"parameters": json.RawMessage(`{"n_samples":128}`)}
		}},
		{"negative steps", func(_ *relaycommon.RelayInfo, r *dto.ImageRequest) {
			r.Extra = map[string]json.RawMessage{"parameters": json.RawMessage(`{"steps":-1}`)}
		}},
		{"url", func(_ *relaycommon.RelayInfo, r *dto.ImageRequest) { r.ResponseFormat = "url" }},
		{"stream", func(_ *relaycommon.RelayInfo, r *dto.ImageRequest) { r.Stream = common.GetPointer(true) }},
		{"resolution", func(_ *relaycommon.RelayInfo, r *dto.ImageRequest) { r.Size = "999999999x999999999" }},
		{"inpainting", func(i *relaycommon.RelayInfo, r *dto.ImageRequest) {
			r.Model = "nai-diffusion-5-full-inpainting"
			i.UpstreamModelName = r.Model
		}},
		{"edits", func(i *relaycommon.RelayInfo, _ *dto.ImageRequest) { i.RelayMode = relayconstant.RelayModeImagesEdits }},
		{"passthrough", func(i *relaycommon.RelayInfo, _ *dto.ImageRequest) { i.ChannelSetting.PassThroughBodyEnabled = true }},
		{"override", func(i *relaycommon.RelayInfo, _ *dto.ImageRequest) {
			i.ParamOverride = map[string]any{"parameters.n_samples": 2}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			info, r := naiFixture()
			tt.change(info, r)
			_, err := convertNAIImage(info, *r)
			require.Error(t, err)
			apiErr, ok := err.(*types.NewAPIError)
			require.True(t, ok)
			assert.Equal(t, 400, apiErr.StatusCode)
		})
	}
}

func TestNAIOptInIsolation(t *testing.T) {
	for _, tt := range []struct {
		name   string
		change func(*relaycommon.RelayInfo)
	}{
		{"default off", func(i *relaycommon.RelayInfo) { i.ChannelOtherSettings.NovelAINativeImages = false }},
		{"other channel", func(i *relaycommon.RelayInfo) { i.ChannelType = constant.ChannelTypeOpenAI }},
		{"other image model", func(i *relaycommon.RelayInfo) { i.UpstreamModelName = "gpt-image-2" }},
		{"chat", func(i *relaycommon.RelayInfo) { i.RelayMode = relayconstant.RelayModeChatCompletions }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			i, _ := naiFixture()
			tt.change(i)
			i.ChannelBaseUrl = "https://example.test"
			i.RequestURLPath = "/v1/images/generations"
			assert.False(t, nativeNAIImages(i))
			a := &Adaptor{}
			url, err := a.GetRequestURL(i)
			require.NoError(t, err)
			assert.Equal(t, "https://example.test/v1/images/generations", url)
		})
	}
}

func TestNAIResponseAndHTTP(t *testing.T) {
	var pngBody bytes.Buffer
	require.NoError(t, png.Encode(&pngBody, image.NewNRGBA(image.Rect(0, 0, 2, 2))))
	zipBody := naiZIP(t, map[string][]byte{"image_0.png": pngBody.Bytes()})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/ai/generate-image", r.URL.Path)
		assert.Equal(t, "Bearer fake-upstream-key", r.Header.Get("Authorization"))
		var body naiImageRequest
		require.NoError(t, common.DecodeJson(r.Body, &body))
		assert.Equal(t, "nai-diffusion-5-full", body.Model)
		assert.Equal(t, 1, body.Parameters.NSamples)
		w.Header().Set("Content-Type", "binary/octet-stream")
		_, _ = w.Write(zipBody)
	}))
	defer upstream.Close()
	info, request := naiFixture()
	info.ChannelBaseUrl = upstream.URL
	info.ApiKey = "fake-upstream-key"
	a := &Adaptor{}
	a.Init(info)
	converted, err := a.ConvertImageRequest(nil, info, *request)
	require.NoError(t, err)
	body, err := common.Marshal(converted)
	require.NoError(t, err)
	bodyReader, err := validateNAIOutbound(info, bytes.NewReader(body))
	require.NoError(t, err)
	url, err := a.GetRequestURL(info)
	require.NoError(t, err)
	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, url, bodyReader)
	require.NoError(t, err)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", nil)
	require.NoError(t, a.SetupRequestHeader(c, &req.Header, info))
	resp, err := upstream.Client().Do(req)
	require.NoError(t, err)
	info.PriceData.UsePrice = true
	_, apiErr := a.DoResponse(c, resp, info)
	require.Nil(t, apiErr)
	assert.Equal(t, 200, recorder.Code)
	assert.Equal(t, "application/json", recorder.Header().Get("Content-Type"))
	var result struct {
		Data []struct {
			B64 string `json:"b64_json"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &result))
	require.Len(t, result.Data, 1)
	decoded, err := base64.StdEncoding.DecodeString(result.Data[0].B64)
	require.NoError(t, err)
	assert.Equal(t, pngBody.Bytes(), decoded)
	assert.Equal(t, float64(1), info.PriceData.OtherRatios()["n"])
	for _, tt := range []struct {
		name string
		body []byte
	}{
		{"html", []byte("<html>error</html>")}, {"empty", naiZIP(t, map[string][]byte{})}, {"nonimage", naiZIP(t, map[string][]byte{"image_0.png": []byte("not a PNG")})},
	} {
		t.Run(tt.name, func(t *testing.T) { _, err := decodeNAIImages(tt.body); require.Error(t, err) })
	}
	tooMany := map[string][]byte{}
	for i := 0; i <= dto.MaxImageN; i++ {
		tooMany[fmt.Sprintf("image_%d.png", i)] = pngBody.Bytes()
	}
	_, err = decodeNAIImages(naiZIP(t, tooMany))
	require.Error(t, err)
	_, err = decodeNAIImages(naiZIP(t, map[string][]byte{"image.png": bytes.Repeat([]byte{0}, naiMaxImageBytes+1)}))
	require.Error(t, err)
	for _, status := range []int{429, 500, 504} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			i, _ := naiFixture()
			resp := &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":{"message":"upstream failed","type":"api_error"}}`))}
			_, e := naiImageResponse(c, resp, i)
			require.NotNil(t, e)
			assert.Equal(t, status, e.StatusCode)
			assert.Nil(t, i.BillingImageCount)
		})
	}
}
