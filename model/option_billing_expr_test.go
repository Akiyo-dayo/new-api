package model

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/config"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 保存计费表达式之前必须真的编译并试算一遍。
//
// 两条坏表达式都不是手写出来的，是可视化编辑器**自己**产出过的形状：
//   - 多档链里非末档的条件被删掉 → 拼出没有 `?` 的裸 `:` → expr-lang 语法错误；
//   - header 等值比较写成裸数字 → header(...) 在 v1 env 里是 string，
//     `== 1` 报 mismatched types string and int。
//
// 两种都会让该模型的阶梯计费在运行时求值失败、退到预扣兜底额，而 model.Pricing 只看
// `BillingExpr != ""` 就把它标成 price_configured=true——广场上标着一个具体的价，
// 点了却按另一个数收钱。这正是 price_configured 当初要消灭的事故形态。
func TestValidateOptionValueRejectsBillingExprThatCannotRun(t *testing.T) {
	cases := []struct {
		name string
		expr string
	}{
		{"非末档缺条件拼出裸冒号", `tier("a", p * 3 + c * 15) : tier("b", p * 6 + c * 30)`},
		{"header 等值写成裸数字", `tier("base", p * 3 + c * 15) * (header("h") == 1 ? 2 : 1)`},
		{"header 等值写成裸布尔", `tier("base", p * 3 + c * 15) * (header("h") == true ? 2 : 1)`},
		{"前端认得但后端不认的版本前缀", `v2:tier("base", p * 3 + c * 15)`},
		{"括号不闭合", `tier("base", p * 3 + c * 15`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			value, err := jsonMapString(map[string]string{"broken-model": tc.expr})
			require.NoError(t, err)

			err = validateOptionValue(billingExprOptionKey, value)
			require.Error(t, err, "这条表达式应该被拦下")
			assert.Contains(t, err.Error(), "broken-model", "错误里必须点名是哪个模型")
		})
	}
}

// 反证：生产在用的那些形状必须照常存得进去。
// 没有这一条，上面的 Error 断言可以靠一个「什么都拒绝」的实现通过，
// 而那会让站长一条价都改不了。
func TestValidateOptionValueAcceptsWorkingBillingExprs(t *testing.T) {
	// 这几条取自 pkg/billingexpr/expr.md 的示例，是文档承诺支持的写法。
	exprs := map[string]string{
		"simple":     `tier("base", p * 2.5 + c * 15 + cr * 0.25)`,
		"versioned":  `v1:tier("base", p * 3 + c * 15)`,
		"multi-tier": `len <= 200000 ? tier("std", p * 3 + c * 15) : tier("long", p * 6 + c * 22.5)`,
		"with-rule":  `tier("base", p * 3 + c * 15) * (header("h") == "fast" ? 2 : 1)`,
		"param-rule": `tier("base", p * 3 + c * 15) * (param("n") != nil && param("n") >= 4 ? 2 : 1)`,
		"empty":      "",
	}
	value, err := jsonMapString(exprs)
	require.NoError(t, err)

	assert.NoError(t, validateOptionValue(billingExprOptionKey, value))
}

// 别的 option 不受影响：这条校验只挂在计费表达式那个键上。
func TestValidateOptionValueIgnoresOtherKeys(t *testing.T) {
	value, err := jsonMapString(map[string]string{"m": `tier("a", p) : tier("b", c)`})
	require.NoError(t, err)

	assert.NoError(t, validateOptionValue("billing_setting.billing_mode", value))
	assert.NoError(t, validateOptionValue("SystemName", "whatever"))
}

func TestValidateOptionValueRejectsMalformedBillingExprJSON(t *testing.T) {
	assert.Error(t, validateOptionValue(billingExprOptionKey, `{"m": "tier(`))
	assert.NoError(t, validateOptionValue(billingExprOptionKey, ""))
	assert.NoError(t, validateOptionValue(billingExprOptionKey, "{}"))
}

// jsonMapString 把「模型 → 表达式」映射序列化成 option 里存的那种字符串。
// 用 common.Marshal 而不是手拼，表达式里有引号和括号。
func jsonMapString(m map[string]string) (string, error) {
	b, err := common.Marshal(m)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// 上面几条用例都拿 billingExprOptionKey 当输入，所以它自己指错了地方也照样绿——
// 实测把它改成 "billing_setting.zz_wrong_field"，那些用例一条都不红。
// 这里钉死它必须等于 handleConfigUpdate 实际收到的那个键：
// 前半段是 config.GlobalConfig.Register 注册的配置名，后半段是 BillingSetting 的
// billing_expr 字段。任何一半漂了，校验就静默挂空档。
func TestBillingExprOptionKeyMatchesTheKeyConfigUpdateReceives(t *testing.T) {
	require.Equal(t, "billing_setting.billing_expr", billingExprOptionKey)

	parts := strings.SplitN(billingExprOptionKey, ".", 2)
	require.Len(t, parts, 2)
	assert.NotNil(t, config.GlobalConfig.Get(parts[0]),
		"前半段必须是一个真的注册过的配置名，否则 handleConfigUpdate 根本不会走到这个键")

	// 反证：这条断言不是随便写个字符串都能过。
	assert.Nil(t, config.GlobalConfig.Get("zz_not_registered"))
}
