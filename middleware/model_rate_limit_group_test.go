package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// 分组限流靠 GetGroupRateLimit(分组名) 查配置，伪分组名永远查不到 —— 那等于 auto 与
// 倍率区间令牌只受全局限流约束。本中间件跑在选路之前，真实分组还不存在，
// 只能回落到用户自己的分组；回落一旦丢掉，这类令牌就绕过了分组限流。
func TestRateLimitGroupFallsBackForPseudoGroups(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name       string
		tokenGroup string
		userGroup  string
		want       string
	}{
		{"倍率区间令牌回落到用户分组", "ratio:0.1-0.3", "vip", "vip"},
		{"区间上下界相同也是伪分组", "ratio:0.18-0.18", "vip", "vip"},
		{"写法非法的区间同样不能当真实分组", "ratio:abc-0.3", "vip", "vip"},
		{"auto 令牌回落到用户分组", "auto", "vip", "vip"},
		{"没绑分组回落到用户分组", "", "vip", "vip"},
		{"绑了真实分组就用它", "premium", "vip", "premium"},
		{"分组名恰好以 ratio 开头但不是前缀写法", "ratiometer", "vip", "ratiometer"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			common.SetContextKey(ctx, constant.ContextKeyTokenGroup, testCase.tokenGroup)
			common.SetContextKey(ctx, constant.ContextKeyUserGroup, testCase.userGroup)

			assert.Equal(t, testCase.want, rateLimitGroup(ctx))
		})
	}
}
