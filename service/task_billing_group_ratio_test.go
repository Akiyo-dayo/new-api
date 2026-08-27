package service

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// GroupGroupRatio 是 (用户分组 -> 使用分组) 的二维覆盖表，首次计费走
// relay/helper.HandleGroupRatio 时用的就是这两个键。任务的 token 差额重算必须查同一格，
// 否则同一次调用「预扣按覆盖价、重算按名义价」，账对不上。
func TestRecalculateTaskQuotaByTokensUsesUserGroupOverride(t *testing.T) {
	truncate(t)

	originalModelRatio := ratio_setting.ModelRatio2JSONString()
	originalGroupRatio := ratio_setting.GroupRatio2JSONString()
	originalGroupGroup := ratio_setting.GroupGroupRatio2JSONString()
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(originalModelRatio))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalGroupRatio))
		require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(originalGroupGroup))
	})
	require.NoError(t, ratio_setting.UpdateModelRatioByJSONString(`{"test-model":1}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"premium":2}`))
	require.NoError(t, ratio_setting.UpdateGroupGroupRatioByJSONString(`{"vip":{"premium":0.5}}`))

	const userID, tokenID, channelID = 77, 77, 77
	require.NoError(t, model.DB.Create(&model.User{
		Id: userID, Username: "vip_user", Group: "vip",
		Quota: 100000, Status: common.UserStatusEnabled,
	}).Error)
	seedToken(t, tokenID, userID, "sk-recalc-groupratio", 100000)
	seedChannel(t, channelID)

	task := makeTask(userID, channelID, 4000, tokenID, BillingSourceWallet, 0)
	task.Group = "premium" // 使用分组，不是用户分组

	RecalculateTaskQuotaByTokens(context.Background(), task, 1000)

	// 1000 tokens × modelRatio 1 × GroupGroupRatio["vip"]["premium"] 0.5 = 500。
	// 查错格（(premium, premium) 未命中）会退回 GroupRatio["premium"]=2 → 2000。
	assert.Equal(t, 500, task.Quota)
}
