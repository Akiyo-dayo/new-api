package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sk-<key>-<渠道ID> 定向调用整段跳过选路，所以**真实分组**同样需要校验
// 「这个分组真的挂着这个渠道和这个模型」。不校验的话，一把便宜分组的令牌可以指到
// 任意一个更贵分组的渠道上，却按自己那个便宜倍率结算。
// 3011 实测：浅夜促销GPT(0.1375) 的令牌 + sk-…-32（渠道 32 属 Snow普通GPT 0.18），
// 同一个 prompt 扣 344，正常走该渠道所属分组是 451——少收 24%。
//
// 处理方式是**拒绝**而不是替它挑一个分组：绑定具体分组的令牌说的是「按这个分组计费」，
// 渠道不在这个分组里时任何替它挑的做法都是猜。曾经猜过「按倍率升序取第一个挂着该渠道的」，
// 结果令牌绑 0.18 的分组、渠道恰好也挂在免费组下时按 0 计费，比原来的 24% 更糟。
func TestDistributeDirectedChannelRejectsRealGroupNotServingChannel(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9701, Group: "pricey", Models: "probe-model", Name: "pricey-ch"}},
		`{"cheap":0.15,"pricey":0.25}`,
		`{"cheap":"","pricey":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "cheap", "9701")

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup),
		"拒绝时绝不能顺手下发一个猜出来的计费分组")
}

// 渠道同时挂在免费组下时尤其不能猜——这正是"按倍率升序取第一个"那版会按 0 计费的场景。
func TestDistributeDirectedChannelRejectsRatherThanFallingIntoFreeGroup(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9705, Group: "free,pricey", Models: "probe-model", Name: "free-ch"}},
		`{"free":0,"snow":0.18,"pricey":0.3}`,
		`{"free":"","snow":"","pricey":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "snow", "9705")

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
}

// 令牌分组确实挂着该渠道时什么都不该发生——这条防止上面那条改过头，
// 把正常的定向调用也改成按别的分组计费。
func TestDistributeDirectedChannelKeepsRealGroupThatServesChannel(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9702, Group: "cheap,pricey", Models: "probe-model", Name: "both-ch"}},
		`{"cheap":0.15,"pricey":0.25}`,
		`{"cheap":"","pricey":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "cheap", "9702")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup),
		"分组本来就挂着该渠道，不需要改写计费分组")
}

// 用户可用分组里没有一个挂着这个渠道时，没有任何可辩护的计费依据：必须拒绝，
// 不能沿用令牌自己的倍率静默扣一笔。
func TestDistributeDirectedChannelRejectsRealGroupWhenNoGroupServesChannel(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9703, Group: "hidden", Models: "probe-model", Name: "hidden-ch"}},
		`{"cheap":0.15,"hidden":0.9}`,
		`{"cheap":""}`)

	ctx, recorder := runDistributeForDirectedChannel(t, "cheap", "9703")

	assert.Equal(t, http.StatusForbidden, recorder.Code)
	assert.Empty(t, common.GetContextKeyString(ctx, constant.ContextKeyAutoGroup))
}

func runDistributeForPlayground(t *testing.T, tokenGroup, requestedGroup string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	recorder := httptest.NewRecorder()
	ctx, _ := gin.CreateTestContext(recorder)
	ctx.Request = httptest.NewRequest(http.MethodPost, "/pg/chat/completions",
		strings.NewReader(`{"model":"probe-model","group":"`+requestedGroup+`"}`))
	ctx.Request.Header.Set("Content-Type", "application/json")

	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, tokenGroup)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, tokenGroup)

	Distribute()(ctx)
	return ctx, recorder
}

// playground 允许在请求体里指定分组，原来只校验「这个分组用户可不可用」，
// 不校验「这个分组配过倍率没有」。可用但没配倍率的分组会走到 GetGroupRatio 的
// 未命中回落 1，于是按原价扣——站点正常倍率 0.15 量级时就是多收 6 倍多。
func TestDistributePlaygroundRejectsGroupWithoutConfiguredRatio(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9801, Group: "noratio", Models: "probe-model", Name: "noratio-ch"}},
		`{"cheap":0.15}`,
		`{"cheap":"","noratio":"可用但没配倍率"}`)

	_, recorder := runDistributeForPlayground(t, "cheap", "noratio")

	assert.Equal(t, http.StatusForbidden, recorder.Code,
		"没配倍率的分组会按 1.0 计费，playground 不能放行")
}

// 配过倍率的分组照常放行——防止上面那条把 playground 的正常切组功能改坏。
func TestDistributePlaygroundAllowsGroupWithConfiguredRatio(t *testing.T) {
	setupDistributorTest(t,
		[]model.Channel{{Id: 9802, Group: "pricey", Models: "probe-model", Name: "pricey-ch"}},
		`{"cheap":0.15,"pricey":0.25}`,
		`{"cheap":"","pricey":""}`)

	ctx, recorder := runDistributeForPlayground(t, "cheap", "pricey")

	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	assert.Equal(t, "pricey", common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup))
}
