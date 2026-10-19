package newapi

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"image/png"
	"io"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/gin-gonic/gin"
)

const naiMaxResponseBytes = 64 << 20
const naiMaxImageBytes = 16 << 20

func nativeNAIImages(info *relaycommon.RelayInfo) bool {
	return info.ChannelType == constant.ChannelTypeNewAPI && info.ChannelOtherSettings.NovelAINativeImages &&
		(info.RelayMode == relayconstant.RelayModeImagesGenerations || info.RelayMode == relayconstant.RelayModeImagesEdits) &&
		strings.HasPrefix(info.UpstreamModelName, "nai-diffusion-")
}

func naiInvalid(message string) *types.NewAPIError {
	return types.NewErrorWithStatusCode(fmt.Errorf("%s", message), types.ErrorCodeInvalidRequest, http.StatusBadRequest, types.ErrOptionWithSkipRetry())
}

// Only these optional scalars cross the native boundary; quantities and model
// selection always come from the gateway's validated image request.
type naiImageOptions struct {
	Seed           *uint32  `json:"seed,omitempty"`
	Steps          *int     `json:"steps,omitempty"`
	Scale          *float64 `json:"scale,omitempty"`
	Sampler        *string  `json:"sampler,omitempty"`
	NegativePrompt *string  `json:"negative_prompt,omitempty"`
	CFGRescale     *float64 `json:"cfg_rescale,omitempty"`
}

type naiImageParameters struct {
	naiImageOptions
	ParamsVersion       int      `json:"params_version"`
	Width               int      `json:"width"`
	Height              int      `json:"height"`
	NSamples            int      `json:"n_samples"`
	UCPreset            int      `json:"ucPreset"`
	QualityToggle       bool     `json:"qualityToggle"`
	DynamicThresholding bool     `json:"dynamic_thresholding"`
	ControlnetStrength  int      `json:"controlnet_strength"`
	Legacy              bool     `json:"legacy"`
	AddOriginalImage    bool     `json:"add_original_image"`
	NoiseSchedule       string   `json:"noise_schedule"`
	LegacyV3Extend      bool     `json:"legacy_v3_extend"`
	SkipCFGAboveSigma   *float64 `json:"skip_cfg_above_sigma"`
	UseCoords           bool     `json:"use_coords"`
	CharacterPrompts    []any    `json:"characterPrompts"`
	V4Prompt            any      `json:"v4_prompt"`
	V4NegativePrompt    any      `json:"v4_negative_prompt"`
}

type naiImageRequest struct {
	Input      string             `json:"input"`
	Model      string             `json:"model"`
	Action     string             `json:"action"`
	Parameters naiImageParameters `json:"parameters"`
}

func convertNAIImage(info *relaycommon.RelayInfo, request dto.ImageRequest) (any, error) {
	if info.RelayMode != relayconstant.RelayModeImagesGenerations {
		return nil, naiInvalid("native NAI image edits are not supported by this channel")
	}
	switch request.Model {
	case "nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-4-5-full", "nai-diffusion-4-5-curated":
	default:
		return nil, naiInvalid("unsupported native NAI text-to-image model")
	}
	if model_setting.GetGlobalSettings().PassThroughRequestEnabled || info.ChannelSetting.PassThroughBodyEnabled || len(info.ParamOverride) > 0 {
		return nil, naiInvalid("native NAI images require body passthrough and parameter overrides to be disabled")
	}
	if request.Stream != nil && *request.Stream {
		return nil, naiInvalid("native NAI images do not support streaming")
	}
	if request.ResponseFormat != "" && request.ResponseFormat != "b64_json" {
		return nil, naiInvalid("native NAI images support only response_format=b64_json")
	}
	if len(request.Image) > 0 || len(request.Images) > 0 || len(request.Mask) > 0 {
		return nil, naiInvalid("native NAI image inputs and masks are not supported")
	}
	n, err := request.ImageCount(false)
	if err != nil {
		return nil, naiInvalid(err.Error())
	}
	width, height := 1024, 1024
	if request.Size != "" {
		w, h, ok := strings.Cut(request.Size, "x")
		if !ok {
			return nil, naiInvalid("size must be WIDTHxHEIGHT")
		}
		width, err = strconv.Atoi(w)
		if err != nil {
			return nil, naiInvalid("invalid image width")
		}
		height, err = strconv.Atoi(h)
		if err != nil {
			return nil, naiInvalid("invalid image height")
		}
	}
	if width < 64 || height < 64 || width > 2048 || height > 2048 || width%64 != 0 || height%64 != 0 || width*height > 2048*2048 {
		return nil, naiInvalid("NAI dimensions must be multiples of 64 between 64 and 2048")
	}
	options := naiImageOptions{}
	if raw, ok := request.Extra["parameters"]; ok {
		var fields map[string]any
		if err := common.Unmarshal(raw, &fields); err != nil {
			return nil, naiInvalid("invalid NAI parameters")
		}
		for key := range fields {
			switch key {
			case "seed", "steps", "scale", "sampler", "negative_prompt", "cfg_rescale":
			default:
				return nil, naiInvalid("unsupported NAI parameter: " + key)
			}
		}
		if err := common.Unmarshal(raw, &options); err != nil {
			return nil, naiInvalid("invalid NAI parameter type")
		}
	}
	for key := range request.Extra {
		if key != "parameters" {
			return nil, naiInvalid("unsupported native NAI field: " + key)
		}
	}
	if options.Seed == nil {
		var seed [4]byte
		if _, err := rand.Read(seed[:]); err != nil {
			return nil, err
		}
		options.Seed = common.GetPointer(binary.LittleEndian.Uint32(seed[:]))
	}
	if options.Steps == nil {
		options.Steps = common.GetPointer(28)
	}
	if options.Scale == nil {
		options.Scale = common.GetPointer(5.0)
	}
	if options.Sampler == nil {
		options.Sampler = common.GetPointer("k_euler_ancestral")
	}
	if options.NegativePrompt == nil {
		options.NegativePrompt = common.GetPointer("low quality, blurry")
	}
	if options.CFGRescale == nil {
		options.CFGRescale = common.GetPointer(0.0)
	}
	if *options.Steps < 1 || *options.Steps > 50 || *options.Scale < 0 || *options.Scale > 10 || *options.CFGRescale < 0 || *options.CFGRescale > 1 {
		return nil, naiInvalid("NAI steps, scale or cfg_rescale is out of range")
	}
	switch *options.Sampler {
	case "k_euler_ancestral", "k_euler", "k_dpmpp_2m", "k_dpmpp_sde", "k_dpmpp_2s_ancestral", "ddim_v3":
	default:
		return nil, naiInvalid("unsupported NAI sampler")
	}
	params := naiImageParameters{naiImageOptions: options, ParamsVersion: 3, Width: width, Height: height, NSamples: n, UCPreset: 0, QualityToggle: true, ControlnetStrength: 1, NoiseSchedule: "karras", CharacterPrompts: []any{},
		V4Prompt:         map[string]any{"caption": map[string]any{"base_caption": request.Prompt, "char_captions": []any{}}, "use_coords": false, "use_order": true},
		V4NegativePrompt: map[string]any{"caption": map[string]any{"base_caption": *options.NegativePrompt, "char_captions": []any{}, "scenery_captions": []any{}}},
	}
	return naiImageRequest{Input: request.Prompt, Model: request.Model, Action: "generate", Parameters: params}, nil
}

// Runs even for body passthrough, after gateway overrides and before any network
// request. Rebuilding the expected body prevents a second unbilled quantity.
func validateNAIOutbound(info *relaycommon.RelayInfo, body io.Reader) (io.Reader, error) {
	request, ok := info.Request.(*dto.ImageRequest)
	if !ok {
		return nil, naiInvalid("invalid native NAI request")
	}
	mapped := *request
	mapped.Model = info.UpstreamModelName
	expected, err := convertNAIImage(info, mapped)
	if err != nil {
		return nil, err
	}
	// The randomly selected seed is allowed to differ from a fresh conversion.
	raw, err := io.ReadAll(io.LimitReader(body, 4<<20+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > 4<<20 {
		return nil, naiInvalid("native NAI request body is too large")
	}
	var actual naiImageRequest
	if err := common.Unmarshal(raw, &actual); err != nil {
		return nil, naiInvalid("invalid native NAI outbound request")
	}
	want := expected.(naiImageRequest)
	if request.Extra["parameters"] == nil || want.Parameters.Seed == nil {
		want.Parameters.Seed = actual.Parameters.Seed
	} else {
		var options naiImageOptions
		_ = common.Unmarshal(request.Extra["parameters"], &options)
		if options.Seed == nil {
			want.Parameters.Seed = actual.Parameters.Seed
		}
	}
	canonical, err := common.Marshal(want)
	if err != nil {
		return nil, err
	}
	var actualMap, wantMap any
	if common.Unmarshal(raw, &actualMap) != nil || common.Unmarshal(canonical, &wantMap) != nil {
		return nil, naiInvalid("invalid native NAI body")
	}
	if !reflect.DeepEqual(actualMap, wantMap) {
		return nil, naiInvalid("native NAI outbound body differs from validated request")
	}
	return bytes.NewReader(raw), nil
}

func naiImageResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("empty NAI response"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	defer service.CloseResponseBodyGracefully(resp)
	if resp.StatusCode != http.StatusOK {
		return nil, service.RelayErrorHandler(c.Request.Context(), resp, false)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, naiMaxResponseBytes+1))
	if err != nil || len(raw) > naiMaxResponseBytes {
		return nil, types.NewOpenAIError(fmt.Errorf("NAI response exceeds limits or cannot be read"), types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	images, err := decodeNAIImages(raw)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	response := struct {
		Created int64               `json:"created"`
		Data    []map[string]string `json:"data"`
	}{Created: time.Now().Unix()}
	for _, image := range images {
		response.Data = append(response.Data, map[string]string{"b64_json": base64.StdEncoding.EncodeToString(image)})
	}
	body, err := common.Marshal(response)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusBadGateway)
	}
	info.UpdateImageCount(int64(len(images)))
	c.Data(http.StatusOK, "application/json", body)
	return &dto.Usage{}, nil
}

func decodeNAIImages(raw []byte) ([][]byte, error) {
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("invalid NAI image ZIP")
	}
	if len(archive.File) > dto.MaxImageN {
		return nil, fmt.Errorf("too many NAI ZIP entries")
	}
	var images [][]byte
	total := 0
	for _, file := range archive.File {
		if !strings.HasSuffix(strings.ToLower(file.Name), ".png") {
			continue
		}
		if file.UncompressedSize64 > naiMaxImageBytes {
			return nil, fmt.Errorf("NAI image exceeds limit")
		}
		reader, err := file.Open()
		if err != nil {
			return nil, fmt.Errorf("invalid NAI ZIP entry")
		}
		image, readErr := io.ReadAll(io.LimitReader(reader, naiMaxImageBytes+1))
		closeErr := reader.Close()
		total += len(image)
		if readErr != nil || closeErr != nil || len(image) > naiMaxImageBytes || total > naiMaxResponseBytes {
			return nil, fmt.Errorf("invalid or oversized NAI image")
		}
		cfg, err := png.DecodeConfig(bytes.NewReader(image))
		if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 2048 || cfg.Height > 2048 {
			return nil, fmt.Errorf("invalid NAI PNG dimensions")
		}
		if _, err := png.Decode(bytes.NewReader(image)); err != nil {
			return nil, fmt.Errorf("invalid NAI PNG")
		}
		images = append(images, image)
	}
	if len(images) == 0 {
		return nil, fmt.Errorf("NAI response contains no images")
	}
	return images, nil
}
