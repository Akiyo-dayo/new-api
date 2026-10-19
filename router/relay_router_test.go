package router

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/png"
	"io"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/tidwall/gjson"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestListModelsSupportsOpenAIAndGeminiAuthentication(t *testing.T) {
	setupRelayRouterTestDB(t)

	user := model.User{
		Username: "models-user",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    100,
	}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		UserId:         user.Id,
		Key:            "modelstestkey",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)

	tests := []struct {
		name           string
		path           string
		headerName     string
		expectedObject string
		expectedField  string
	}{
		{
			name:           "OpenAI bearer token",
			path:           "/v1/models",
			headerName:     "Authorization",
			expectedObject: "list",
			expectedField:  "data",
		},
		{
			name:          "Gemini API key header",
			path:          "/v1/models",
			headerName:    "x-goog-api-key",
			expectedField: "models",
		},
		{
			name:          "Gemini API key query",
			path:          "/v1/models?key=modelstestkey",
			expectedField: "models",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.headerName != "" {
				value := "modelstestkey"
				if test.headerName == "Authorization" {
					value = "Bearer " + value
				}
				request.Header.Set(test.headerName, value)
			}

			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusOK, recorder.Code)
			var payload map[string]any
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.Contains(t, payload, test.expectedField)
			assert.NotContains(t, payload, "error")
			if test.expectedObject != "" {
				assert.Equal(t, test.expectedObject, payload["object"])
			}
		})
	}
}

func TestNAIOrdinaryUserImageRelay(t *testing.T) {
	setupRelayRouterTestDB(t)
	service.InitHttpClient()
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Log{}, &model.UserSubscription{}, &model.Option{}))
	originalPrice := ratio_setting.ModelPrice2JSONString()
	t.Cleanup(func() { require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(originalPrice)) })
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"nai-diffusion-5-full@岸":0.04}`))
	var pngBytes bytes.Buffer
	require.NoError(t, png.Encode(&pngBytes, image.NewNRGBA(image.Rect(0, 0, 2, 2))))
	var zipBytes bytes.Buffer
	zw := zip.NewWriter(&zipBytes)
	entry, err := zw.Create("image_0.png")
	require.NoError(t, err)
	_, err = entry.Write(pngBytes.Bytes())
	require.NoError(t, err)
	require.NoError(t, zw.Close())
	calls := 0
	fail := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		assert.Equal(t, "/ai/generate-image", r.URL.Path)
		assert.Equal(t, "Bearer fixture-upstream", r.Header.Get("Authorization"))
		body, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		assert.Equal(t, "nai-diffusion-5-full", gjson.GetBytes(body, "model").String())
		assert.EqualValues(t, 1, gjson.GetBytes(body, "parameters.n_samples").Int())
		if fail {
			w.WriteHeader(502)
			_, _ = io.WriteString(w, `{"error":{"message":"fixture failure","type":"upstream_error"}}`)
			return
		}
		w.Header().Set("Content-Type", "binary/octet-stream")
		_, _ = w.Write(zipBytes.Bytes())
	}))
	defer upstream.Close()
	user := model.User{Username: "nai-ordinary-user", Role: common.RoleCommonUser, Status: common.UserStatusEnabled, Group: "default", Quota: 1000000}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{UserId: user.Id, Name: "NAI fixture", Key: "naiordinaryfixture", Status: common.TokenStatusEnabled, ExpiredTime: -1, RemainQuota: 1000000, Group: "default"}).Error)
	channel := model.Channel{Type: constant.ChannelTypeNewAPI, Name: "nai isolated fixture", Key: "fixture-upstream", Status: common.ChannelStatusEnabled, BaseURL: common.GetPointer(upstream.URL), Models: "nai-diffusion-5-full@岸", Group: "default", ModelMapping: common.GetPointer(`{"nai-diffusion-5-full@岸":"nai-diffusion-5-full"}`), OtherSettings: `{"novelai_native_images":true}`}
	require.NoError(t, channel.Insert())
	engine := gin.New()
	SetRelayRouter(engine)
	SetTaskPluginProtocolRouter(engine)
	requestBody := `{"model":"nai-diffusion-5-full@岸","prompt":"an apple","size":"512x512","response_format":"b64_json","n":1}`
	for _, tt := range []struct {
		name, key, body string
		status          int
	}{
		{"anonymous", "", requestBody, 401},
		{"ordinary token", "naiordinaryfixture", requestBody, 200},
		{"nested quantity", "naiordinaryfixture", `{"model":"nai-diffusion-5-full@岸","prompt":"apple","parameters":{"n_samples":128}}`, 400},
	} {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(tt.body))
			req.Header.Set("Content-Type", "application/json")
			if tt.key != "" {
				req.Header.Set("Authorization", "Bearer "+tt.key)
			}
			engine.ServeHTTP(recorder, req)
			require.Equal(t, tt.status, recorder.Code, recorder.Body.String())
			if tt.status == 200 {
				encoded := gjson.GetBytes(recorder.Body.Bytes(), "data.0.b64_json").String()
				decoded, err := base64.StdEncoding.DecodeString(encoded)
				require.NoError(t, err)
				assert.Equal(t, pngBytes.Bytes(), decoded)
			}
		})
	}
	assert.Equal(t, 1, calls)
	fail = true
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/images/generations", strings.NewReader(requestBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer naiordinaryfixture")
	engine.ServeHTTP(recorder, req)
	assert.Equal(t, 502, recorder.Code, recorder.Body.String())
	require.Eventually(t, func() bool {
		var current model.User
		if model.DB.First(&current, user.Id).Error != nil {
			return false
		}
		return current.Quota == 980000
	}, 3*time.Second, 10*time.Millisecond, "only the successful image should be charged; rejected and upstream-failed requests must refund")
	var currentToken model.Token
	require.Eventually(t, func() bool {
		return model.DB.Where("key = ?", "naiordinaryfixture").First(&currentToken).Error == nil && currentToken.RemainQuota == 980000
	}, 3*time.Second, 10*time.Millisecond, "failed image requests must refund the token reservation")
}

func setupRelayRouterTestDB(t *testing.T) {
	t.Helper()

	gin.SetMode(gin.TestMode)
	originalIsMasterNode := common.IsMasterNode
	originalRedisEnabled := common.RedisEnabled
	originalSQLitePath := common.SQLitePath
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")

	common.IsMasterNode = false
	common.RedisEnabled = false
	common.SQLitePath = fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Ability{}))

	t.Cleanup(func() {
		if sqlDB, err := model.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
		common.IsMasterNode = originalIsMasterNode
		common.RedisEnabled = originalRedisEnabled
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		if hadSQLDSN {
			require.NoError(t, os.Setenv("SQL_DSN", originalSQLDSN))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	})
}
