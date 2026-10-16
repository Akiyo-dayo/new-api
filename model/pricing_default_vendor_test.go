package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// 一个模型名同时命中多个供应商模式时，胜者必须是确定的、而且要选对。
//
// 原来的实现是遍历 map 命中即 break，而 Go 的 map 迭代顺序是随机的：
// gpt-5.3-codex-spark 既含 "gpt"(OpenAI) 又含 "spark"(讯飞)，于是它在 3011 上被判成讯飞，
// 而且重启一次就可能变成 OpenAI —— 同一份数据两次启动给出两个厂商。
func TestMatchDefaultVendorPrefersLeftmostPattern(t *testing.T) {
	cases := []struct {
		modelName string
		want      string
		why       string
	}{
		// 这一行同时是"结果不依赖 map 迭代顺序"的守卫：换回命中即 break 的写法，
		// 它会随机地时对时错，用例随之变成不稳定失败。
		{"gpt-5.3-codex-spark", "OpenAI", "带 codex-spark 后缀的 GPT，不是星火"},
		{"cy-gpt-5.3-codex-spark", "OpenAI", "渠道前缀不改变 gpt 与 spark 的先后"},
		{"spark-max", "讯飞", "讯飞自家模型里 spark 就在最前面"},
		{"spark-lite", "讯飞", ""},
		{"gpt-4o", "OpenAI", ""},
		{"claude-opus-4-5", "Anthropic", ""},
		{"gemini-3-flash", "Google", ""},
		{"deepseek-v4-pro", "DeepSeek", ""},
		{"glm-5.2", "智谱", "glm- 带横杠的模式也要能命中"},
		{"@cf/meta/llama-3", "Cloudflare", "@cf/ 在最左，胜过后面的 llama"},
		{"完全不认识的模型", "", "猜不出来就不要猜"},
	}

	for _, tc := range cases {
		t.Run(tc.modelName, func(t *testing.T) {
			assert.Equal(t, tc.want, matchDefaultVendor(tc.modelName), tc.why)
		})
	}
}

// 两个模式在同一位置起头时取更长的那个（更具体）。
//
// 当前的 defaultVendorRules 里恰好没有互为前缀的模式，所以这条规则今天不可达——
// 直接对它做变异不会被上面两条用例打红。但那张表是会长的：哪天加了 "gpt-4o" 这种更细的
// 模式，没有这条规则就又回到"看 map 迭代顺序"。这里临时往表里塞一对重叠模式把它钉住。
func TestMatchDefaultVendorPrefersLongerPatternAtSamePosition(t *testing.T) {
	const generic, specific = "zzvendor", "zzvendorpro"
	defaultVendorRules[generic] = "泛供应商"
	defaultVendorRules[specific] = "专供应商"
	t.Cleanup(func() {
		delete(defaultVendorRules, generic)
		delete(defaultVendorRules, specific)
	})

	assert.Equal(t, "专供应商", matchDefaultVendor("zzvendorpro-max"),
		"两个模式都从下标 0 命中，更长的那个更具体")
	assert.Equal(t, "泛供应商", matchDefaultVendor("zzvendor-max"))
}
