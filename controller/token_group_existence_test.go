package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withUsableGroups 换掉可用分组配置并在用例结束后还原。
func withUsableGroups(t *testing.T, usableGroups string) {
	t.Helper()

	original := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(original))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usableGroups))
}

func addTokenWithGroup(t *testing.T, group string) tokenAPIResponse {
	t.Helper()

	ctx, recorder := newAuthenticatedContext(t, http.MethodPost, "/api/token/", map[string]any{
		"name":            "probe",
		"group":           group,
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 1)
	AddToken(ctx)
	return decodeAPIResponse(t, recorder)
}

// 填一个根本不存在的分组名同样是「建得出、调不通」：middleware/auth.go 要到**调用时**
// 才报「无权访问 X 分组」。区间写法已经在创建时挡住了，真实分组名是同一个入口的另一半。
func TestAddTokenRejectsGroupOutsideUsableGroups(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜"}`)

	response := addTokenWithGroup(t, "打错的分组名")

	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "打错的分组名")

	var count int64
	require.NoError(t, model.DB.Model(&model.Token{}).Count(&count).Error)
	assert.Zero(t, count, "被拒绝的令牌不能落库")
}

// auto 在这台站上没被加进 UserUsableGroups，于是所有 auto 令牌调用时一律 403。
// 创建时同样要挡，否则用户会以为自己建了一把能用的 auto 令牌。
func TestAddTokenRejectsAutoGroupWhenNotUsable(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜"}`)

	assert.False(t, addTokenWithGroup(t, "auto").Success)
}

func TestAddTokenAcceptsAutoGroupWhenUsable(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜","auto":"自动"}`)

	require.True(t, addTokenWithGroup(t, "auto").Success)
}

func TestAddTokenAcceptsUsableGroup(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜"}`)

	require.True(t, addTokenWithGroup(t, "cheap").Success)

	var stored model.Token
	require.NoError(t, model.DB.Where("name = ?", "probe").First(&stored).Error)
	assert.Equal(t, "cheap", stored.Group)
}

// 用户自己的分组即使不在 UserUsableGroups 里也必须放行 —— GetUserUsableGroups 会把它
// 补进去，auth.go 因此也是放行的。这条防止新校验把最常见的一种令牌挡在门外。
func TestAddTokenAcceptsOwnGroupNotListedInUsableGroups(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜"}`)

	require.True(t, addTokenWithGroup(t, "default").Success,
		"令牌拥有者自己的分组必须能填")
}

// 空分组表示「跟随用户分组」，auth.go 整段跳过校验，创建时也不能拦。
func TestAddTokenAcceptsEmptyGroup(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜"}`)

	require.True(t, addTokenWithGroup(t, "").Success)
}

// 倍率区间只校验写法，不校验「此刻区间内有没有分组」：区间是一条**策略**
// （"我最多接受到这个价"），今天没有符合的分组不代表这把 key 是错的，
// 而分组倍率随时会调。写法错了才是真的错了。
func TestAddTokenAcceptsRatioRangeWithNoMatchingGroupToday(t *testing.T) {
	setupTokenControllerTestDB(t)
	withUsableGroups(t, `{"cheap":"便宜"}`)

	require.True(t, addTokenWithGroup(t, "ratio:0.9-0.95").Success)
}

func TestUpdateTokenRejectsGroupOutsideUsableGroups(t *testing.T) {
	db := setupTokenControllerTestDB(t)
	existing := seedToken(t, db, 1, "range-token", "abcd1234efgh5678")
	withUsableGroups(t, `{"cheap":"便宜"}`)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
		"id":              existing.Id,
		"name":            "range-token",
		"group":           "打错的分组名",
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 1)
	UpdateToken(ctx)

	assert.False(t, decodeAPIResponse(t, recorder).Success)

	var stored model.Token
	require.NoError(t, model.DB.First(&stored, existing.Id).Error)
	assert.Equal(t, "default", stored.Group, "被拒绝的更新不能改动已存分组")
}
