package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// setupDistributorTest 起一个只装了渠道与分组的最小环境：Distribute 的定向分支要能
// GetChannelById，ResolveChannelBillingGroup 要能查渠道内存缓存。
func setupDistributorTest(t *testing.T, channels []model.Channel, groupRatio, usableGroups string) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	previousDB, previousType := model.DB, common.MainDatabaseType()
	previousRedis, previousMemoryCache := common.RedisEnabled, common.MemoryCacheEnabled
	previousRatio := ratio_setting.GroupRatio2JSONString()
	previousUsable := setting.UserUsableGroups2JSONString()

	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Channel{}, &model.Ability{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	common.RedisEnabled = false
	common.MemoryCacheEnabled = true
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(groupRatio))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(usableGroups))

	for i := range channels {
		channels[i].Status = common.ChannelStatusEnabled
		require.NoError(t, model.DB.Create(&channels[i]).Error)
		for _, group := range strings.Split(channels[i].Group, ",") {
			for _, name := range strings.Split(channels[i].Models, ",") {
				require.NoError(t, model.DB.Create(&model.Ability{
					Group: group, Model: name, ChannelId: channels[i].Id, Enabled: true,
				}).Error)
			}
		}
	}
	model.InitChannelCache()

	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
		common.RedisEnabled = previousRedis
		common.MemoryCacheEnabled = previousMemoryCache
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(previousRatio))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(previousUsable))
	})
}

func runDistributeForDirectedChannel(t *testing.T, tokenGroup, channelID string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		strings.NewReader(`{"model":"probe-model"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	common.SetContextKey(ctx, constant.ContextKeyTokenSpecificChannelId, channelID)
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, tokenGroup)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "tester")

	Distribute()(ctx)
	return ctx, recorder
}

// sk-<key>-<渠道ID> 定向调用整段跳过选路，伪分组就没人展开成真实分组。
// 计费读 ContextKeyAutoGroup，拿不到就用伪分组名去查 GetGroupRatio，未命中回落 1.0：
// 3011 实测同渠道同模型贵 5.56 倍（= 1/0.18）。
func TestDistributeDirectedChannelResolvesPseudoGroup(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9501, Group: "mid,pricey", Models: "probe-model", Name: "probe"}},
		`{"cheap":0.15,"mid":0.2,"pricey":0.25}`,
		`{"cheap":"","mid":"","pricey":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "ratio:0.15-0.25", "9501")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Equal(t, "mid", common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup),
		"定向分支必须把伪分组回推成真实分组，取渠道所属分组里最便宜的那个")
}

func TestDistributeDirectedChannelResolvesAutoGroup(t *testing.T) {
	previousAuto := setting.AutoGroups2JsonString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateAutoGroupsByJsonString(previousAuto)) })
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["cheap","pricey"]`))
	setupDistributorTest(t,
		[]model.Channel{{Id: 9502, Group: "pricey", Models: "probe-model", Name: "probe"}},
		`{"cheap":0.15,"pricey":0.25}`,
		`{"cheap":"","pricey":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "auto", "9502")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Equal(t, "pricey", common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
}

// 回推不出来时必须拒绝。放行等于静默按倍率 1.0 计费，用户不会知道自己被按原价扣了。
func TestDistributeDirectedChannelRejectsWhenGroupUnresolvable(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9503, Group: "pricey", Models: "probe-model", Name: "probe"}},
		`{"cheap":0.15,"pricey":1.1}`,
		`{"cheap":"","pricey":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "ratio:0.1-0.2", "9503")

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
}

// 普通分组令牌不该被这条新逻辑碰到：它本来就是真实分组，回推函数必须放行，
// 否则一个正常的定向调用会被当成"解析失败"挡掉。
func TestDistributeDirectedChannelLeavesRealGroupAlone(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9504, Group: "mid", Models: "probe-model", Name: "probe"}},
		`{"mid":0.2}`,
		`{"mid":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "mid", "9504")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup),
		"真实分组不需要回推，也就不该下发 auto_group")
}

// 渠道亲和是第二条绕过选路的入口：命中缓存后直接定住渠道，同样没人把伪分组展开。
// 这里跑两次请求 —— 第一次正常选路顺便把亲和写进缓存，第二次命中亲和 ——
// 断言第二次仍然下发了真实分组。
func TestDistributeAffinityHitResolvesPseudoGroup(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{
			{Id: 9601, Group: "cheap", Models: "probe-model", Name: "cheap-ch"},
			{Id: 9602, Group: "pricey", Models: "probe-model", Name: "pricey-ch"},
		},
		`{"cheap":0.15,"pricey":0.25}`,
		`{"cheap":"","pricey":""}`)

	affinity := operation_setting.GetChannelAffinitySetting()
	previous := *affinity
	t.Cleanup(func() { *affinity = previous })
	*affinity = operation_setting.ChannelAffinitySetting{
		Enabled:           true,
		SwitchOnSuccess:   false,
		MaxEntries:        16,
		DefaultTTLSeconds: 600,
		Rules: []operation_setting.ChannelAffinityRule{{
			Name:       "probe affinity",
			ModelRegex: []string{"^probe-model$"},
			KeySources: []operation_setting.ChannelAffinityKeySource{
				{Type: "request_header", Key: "X-Probe-Session"},
			},
			TTLSeconds:        600,
			IncludeUsingGroup: true,
			IncludeRuleName:   true,
		}},
	}

	run := func() *gin.Context {
		recorder := httptest.NewRecorder()
		ctx, _ := gin.CreateTestContext(recorder)
		ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
			strings.NewReader(`{"model":"probe-model"}`))
		ctx.Request.Header.Set("Content-Type", "application/json")
		ctx.Request.Header.Set("X-Probe-Session", "probe-session-1")
		common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "ratio:0.15-0.25")
		common.SetContextKey(ctx, constant.ContextKeyUserGroup, "tester")
		Distribute()(ctx)
		return ctx
	}

	first := run()
	require.Equal(t, "cheap", common.GetContextKeyString(first, constant.ContextKeyAutoGroup),
		"第一次走正常选路，取区间内最便宜的分组")

	second := run()
	assert.Equal(t, "cheap", common.GetContextKeyString(second, constant.ContextKeyAutoGroup),
		"亲和命中后仍必须下发真实分组，否则这条路径上计费回落到倍率 1.0")
	assert.Equal(t, 9601, common.GetContextKeyInt(second, constant.ContextKeyChannelId))
}

// MJ/Suno 取结果这类请求不带模型名，定向调用时必须原样放行：
// 既不能被计费校验挡成 403，也不该下发 auto_group（它们不选路也不计费）。
func TestDistributeDirectedChannelPassesThroughWhenModelNameIsEmpty(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9907, Group: "cheap", Models: "probe-model", Name: "probe"}},
		`{"cheap":0.15,"pricey":0.3}`,
		`{"cheap":"","pricey":""}`)

	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions",
		strings.NewReader(`{"model":""}`))
	ctx.Request.Header.Set("Content-Type", "application/json")
	common.SetContextKey(ctx, constant.ContextKeyTokenSpecificChannelId, "9907")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "cheap")
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "tester")

	Distribute()(ctx)

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.False(t, ctx.IsAborted(), "不带模型名的定向请求不该被中断")
	assert.Equal(t, 9907, common.GetContextKeyInt(ctx, constant.ContextKeyChannelId),
		"渠道仍然要被定住，否则任务提交和取结果会落到不同渠道")
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup),
		"这类请求不计费，不该下发计费分组")
}
