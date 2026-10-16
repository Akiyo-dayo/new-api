package controller

import (
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 分组是会变的：站长删掉一个分组、改个名、或者把某个用户挪出可用范围之后，
// 库里仍然存着一批绑着旧分组名的令牌。
//
// 建令牌时校验分组是对的；但改名、改额度、改过期时间走的是同一个校验，
// 而前端提交的是整个令牌对象（含它原本的 group）。如果对未改动的 group 也重新校验，
// 用户就会遇到「我只是想改个名字，它说我无权访问某个分组」——
// 而且这把令牌从此再也改不动，连关掉它都做不到。
func TestUpdateTokenAllowsEditingWhenStoredGroupNoLongerUsable(t *testing.T) {
	db := setupTokenControllerTestDB(t)

	previousUsable := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
	})
	// 令牌当初是在 legacy 分组可用的时候建的
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"legacy":"旧分组","current":"在用"}`))
	require.NoError(t, db.Exec("DELETE FROM users").Error)
	require.NoError(t, db.Create(&model.User{
		Id: 1, Username: "token_owner", Group: "default",
		Quota: 1000, Status: common.UserStatusEnabled,
	}).Error)
	existing := seedToken(t, db, 1, "legacy-token", "abcd1234efgh5678")
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", existing.Id).
		Update("group", "legacy").Error)

	// 站长后来把 legacy 分组下线了
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"current":"在用"}`))

	// 用户只想改个名字，group 原样带回来（前端就是这么提交的）
	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
		"id":              existing.Id,
		"name":            "renamed-token",
		"group":           "legacy",
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 1)
	UpdateToken(ctx)

	response := decodeAPIResponse(t, recorder)
	assert.True(t, response.Success,
		"未改动分组的编辑不该被分组校验挡掉，否则存量令牌永远改不动：%s", response.Message)

	var stored model.Token
	require.NoError(t, model.DB.First(&stored, existing.Id).Error)
	assert.Equal(t, "renamed-token", stored.Name)
}

// 反面：真的把分组改成一个自己无权访问的，仍然必须被挡住。
func TestUpdateTokenStillRejectsSwitchingToUnusableGroup(t *testing.T) {
	db := setupTokenControllerTestDB(t)

	previousUsable := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
	})
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"current":"在用"}`))
	require.NoError(t, db.Exec("DELETE FROM users").Error)
	require.NoError(t, db.Create(&model.User{
		Id: 1, Username: "token_owner", Group: "default",
		Quota: 1000, Status: common.UserStatusEnabled,
	}).Error)
	existing := seedToken(t, db, 1, "normal-token", "ijkl1234mnop5678")
	require.NoError(t, db.Model(&model.Token{}).Where("id = ?", existing.Id).
		Update("group", "current").Error)

	ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
		"id":              existing.Id,
		"name":            "normal-token",
		"group":           "someone-elses-group",
		"unlimited_quota": true,
		"expired_time":    -1,
	}, 1)
	UpdateToken(ctx)

	assert.False(t, decodeAPIResponse(t, recorder).Success)

	var stored model.Token
	require.NoError(t, model.DB.First(&stored, existing.Id).Error)
	assert.Equal(t, "current", stored.Group, "被拒绝的更新不能改动已存分组")
}

// 「只在分组变化时校验」的真正风险面：不能变成「旧值非法就一路放行」。
// 从一个失效分组改到另一个失效分组，用户是在**做出新选择**，必须仍然被拒；
// 从失效分组改到合法分组，是用户在修好它，必须放行。
func TestUpdateTokenValidatesOnlyWhenGroupActuallyChanges(t *testing.T) {
	cases := []struct {
		name     string
		newGroup string
		wantOK   bool
		wantroup string
	}{
		{"失效分组改成另一个失效分组：仍然拒绝", "another-dead-group", false, "legacy"},
		{"失效分组改成合法分组：放行", "current", true, "current"},
		{"分组原样不动：放行", "legacy", true, "legacy"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			db := setupTokenControllerTestDB(t)
			previousUsable := setting.UserUsableGroups2JSONString()
			t.Cleanup(func() {
				require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
			})
			require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"current":"在用"}`))
			require.NoError(t, db.Exec("DELETE FROM users").Error)
			require.NoError(t, db.Create(&model.User{
				Id: 1, Username: "token_owner", Group: "default",
				Quota: 1000, Status: common.UserStatusEnabled,
			}).Error)
			existing := seedToken(t, db, 1, "legacy-token", "abcd1234efgh5678")
			require.NoError(t, db.Model(&model.Token{}).Where("id = ?", existing.Id).
				Update("group", "legacy").Error)

			ctx, recorder := newAuthenticatedContext(t, http.MethodPut, "/api/token/", map[string]any{
				"id":              existing.Id,
				"name":            "legacy-token",
				"group":           testCase.newGroup,
				"unlimited_quota": true,
				"expired_time":    -1,
			}, 1)
			UpdateToken(ctx)

			assert.Equal(t, testCase.wantOK, decodeAPIResponse(t, recorder).Success)

			var stored model.Token
			require.NoError(t, model.DB.First(&stored, existing.Id).Error)
			assert.Equal(t, testCase.wantroup, stored.Group)
		})
	}
}
