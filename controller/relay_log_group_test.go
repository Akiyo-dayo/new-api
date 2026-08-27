package controller

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

// 同一次请求的消费日志（type=2）记的是选路后的真实分组，错误日志（type=5）必须记同一个，
// 否则一次调用在两张表里挂着两个分组名，按分组筛日志、算分组营收都会漏掉
// auto 与倍率区间令牌。
func TestErrorLogGroupPrefersResolvedGroup(t *testing.T) {
	gin.SetMode(gin.TestMode)

	cases := []struct {
		name       string
		usingGroup string
		resolved   string
		want       string
	}{
		{"区间令牌记选路定下的真实分组", "ratio:0.1-0.3", "Snow普通GPT", "Snow普通GPT"},
		{"auto 令牌同理", "auto", "浅夜促销GPT", "浅夜促销GPT"},
		{"普通分组令牌照记自己", "premium", "", "premium"},
		{"选路失败没定下分组时退回令牌分组", "ratio:0.1-0.3", "", "ratio:0.1-0.3"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
			common.SetContextKey(ctx, constant.ContextKeyUsingGroup, testCase.usingGroup)
			if testCase.resolved != "" {
				common.SetContextKey(ctx, constant.ContextKeyAutoGroup, testCase.resolved)
			}

			assert.Equal(t, testCase.want, errorLogGroup(ctx))
		})
	}
}
