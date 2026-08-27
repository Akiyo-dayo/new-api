package service

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// seedChannelGroups 把 (分组 -> 渠道 -> 模型) 灌进渠道内存缓存，
// IsChannelEnabledForGroupModel 读的就是它。
func seedChannelGroups(t *testing.T, channels []model.Channel) {
	t.Helper()
	originalMemoryCache := common.MemoryCacheEnabled
	common.MemoryCacheEnabled = true
	require.NoError(t, model.DB.AutoMigrate(&model.Channel{}, &model.Ability{}))
	require.NoError(t, model.DB.Exec("DELETE FROM channels").Error)
	require.NoError(t, model.DB.Exec("DELETE FROM abilities").Error)

	for i := range channels {
		channels[i].Status = common.ChannelStatusEnabled
		require.NoError(t, model.DB.Create(&channels[i]).Error)
		// InitChannelCache 只为 abilities 里出现过的分组建桶，缺了就 panic。
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
		require.NoError(t, model.DB.Exec("DELETE FROM channels").Error)
		require.NoError(t, model.DB.Exec("DELETE FROM abilities").Error)
		model.InitChannelCache()
		common.MemoryCacheEnabled = originalMemoryCache
	})
}

// 定向调用（sk-<key>-<渠道ID>）与渠道亲和都会跳过选路。伪分组必须在那之前被回推成
// 真实分组，否则 GetGroupRatio("ratio:0.15-0.25") 未命中回落到 1.0，用户按原价被扣。
func TestResolveChannelBillingGroupPicksCheapestGroupServingChannel(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","mid":"中","pricey":"贵"}`,
		`{"cheap":0.15,"mid":0.2,"pricey":0.25}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9001, Group: "mid,pricey", Models: "probe-model"},
		{Id: 9002, Group: "cheap", Models: "other-model"},
	})

	group, isPseudo, err := ResolveChannelBillingGroup("ratio:0.15-0.25", "tester", "probe-model", 9001)

	require.True(t, isPseudo)
	require.NoError(t, err)
	assert.Equal(t, "mid", group, "渠道同时挂在 mid 与 pricey 下，应取便宜的那个")
}

func TestResolveChannelBillingGroupResolvesAutoGroup(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.15,"pricey":0.25}`,
		`{}`)
	originalAuto := setting.AutoGroups2JsonString()
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAuto))
	})
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["cheap","pricey"]`))
	seedChannelGroups(t, []model.Channel{
		{Id: 9101, Group: "pricey", Models: "probe-model"},
	})

	group, isPseudo, err := ResolveChannelBillingGroup("auto", "tester", "probe-model", 9101)

	require.True(t, isPseudo)
	require.NoError(t, err)
	assert.Equal(t, "pricey", group)
}

// 回推不出来时必须报错。返回空分组让调用方继续，等于静默按倍率 1.0 计费——
// 实测过一次同渠道同模型贵 5.56 倍（= 1/0.18）。
func TestResolveChannelBillingGroupErrorsWhenChannelOutsideRange(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.15,"pricey":1.1}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9201, Group: "pricey", Models: "probe-model"},
	})

	group, isPseudo, err := ResolveChannelBillingGroup("ratio:0.1-0.2", "tester", "probe-model", 9201)

	require.True(t, isPseudo, "是伪分组，调用方必须处理")
	require.Error(t, err)
	assert.Empty(t, group)
}

// 普通分组令牌本来就不需要回推，第二个返回值必须是 false，
// 否则调用方会把一个正常分组当成解析失败挡掉。
func TestResolveChannelBillingGroupIgnoresRealGroup(t *testing.T) {
	withGroupSettings(t,
		`{"cheap":"便宜"}`,
		`{"cheap":0.15}`,
		`{}`)

	group, isPseudo, err := ResolveChannelBillingGroup("cheap", "tester", "probe-model", 9301)

	assert.False(t, isPseudo)
	assert.NoError(t, err)
	assert.Empty(t, group)
}

// 选路定下真实分组后必须把它下发到 ContextKeyAutoGroup —— 计费、日志分组、渠道亲和
// 全靠这一个 key 拿到"这次到底按哪个分组算钱"。丢了它，HandleGroupRatio 会拿伪分组名
// 去查 GetGroupRatio，未命中回落到 1.0，用户按原价被扣。
func TestCacheGetRandomSatisfiedChannelPublishesResolvedGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)
	withGroupSettings(t,
		`{"cheap":"便宜","pricey":"贵"}`,
		`{"cheap":0.15,"pricey":0.25}`,
		`{}`)
	seedChannelGroups(t, []model.Channel{
		{Id: 9401, Group: "cheap", Models: "probe-model"},
		{Id: 9402, Group: "pricey", Models: "probe-model"},
	})

	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "tester")

	channel, selectGroup, err := CacheGetRandomSatisfiedChannel(&RetryParam{
		Ctx:        ctx,
		TokenGroup: "ratio:0.15-0.25",
		ModelName:  "probe-model",
		Retry:      common.GetPointer(0),
	})

	require.NoError(t, err)
	require.NotNil(t, channel)
	assert.Equal(t, "cheap", selectGroup, "区间内最低价优先")
	assert.Equal(t, 9401, channel.Id)
	assert.Equal(t, "cheap", common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup),
		"选中的真实分组必须下发到 ContextKeyAutoGroup，否则计费拿不到它")
}
