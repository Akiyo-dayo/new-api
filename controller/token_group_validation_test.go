package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 倍率区间是伪分组，写法非法时 middleware/auth.go 会在**调用时** 403。
// 创建接口不校验的话，用户拿到的是一把建的时候一切正常、一用就报错的 key，
// 而错误信息出现在调用方那边，跟创建这个动作已经隔了十万八千里。
func TestAddTokenRejectsMalformedRatioRangeGroup(t *testing.T) {
	invalid := map[string]string{
		"下界大于上界": "ratio:0.3-0.1",
		"下界不是数字": "ratio:abc-0.3",
		"区间为空":   "ratio:",
		"缺分隔符":   "ratio:0.3",
		"下界为负":   "ratio:-0.1-0.3",
	}

	for name, group := range invalid {
		t.Run(name, func(t *testing.T) {
			setupTokenControllerTestDB(t)

			ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", map[string]any{
				"name":            "bad-range",
				"group":           group,
				"unlimited_quota": true,
				"expired_time":    -1,
			}, 1)
			AddToken(ctx)

			response := decodeAPIResponse(t, recorder)
			assert.False(t, response.Success, "非法区间必须被拒绝")
			assert.NotEmpty(t, response.Message)

			var count int64
			require.NoError(t, model.DB.Model(&model.Token{}).Count(&count).Error)
			assert.Zero(t, count, "被拒绝的令牌不能落库")
		})
	}
}

func TestAddTokenAcceptsValidRatioRangeGroup(t *testing.T) {
	setupTokenControllerTestDB(t)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", map[string]any{
		"name":            "good-range",
		"group":           "ratio:0.1-0.3",
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 1)
	AddToken(ctx)

	require.True(t, decodeAPIResponse(t, recorder).Success)

	var stored model.Token
	require.NoError(t, model.DB.Where("name = ?", "good-range").First(&stored).Error)
	assert.Equal(t, "ratio:0.1-0.3", stored.Group)
}

func TestUpdateTokenRejectsMalformedRatioRangeGroup(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	existing := seedToken(t, db, 1, "range-token", "abcd1234efgh5678")

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
		"id":              existing.Id,
		"name":            "range-token",
		"group":           "ratio:0.3-0.1",
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 1)
	UpdateToken(ctx)

	assert.False(t, decodeAPIResponse(t, recorder).Success)

	var stored model.Token
	require.NoError(t, model.DB.First(&stored, existing.Id).Error)
	assert.Equal(t, "default", stored.Group, "被拒绝的更新不能改动已存分组")
}
