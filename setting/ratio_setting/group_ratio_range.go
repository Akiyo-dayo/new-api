package ratio_setting

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// TokenGroupRatioRangePrefix 是令牌 group 字段选择「倍率区间」而不是某个具体分组时的前缀。
//
// 令牌填 ratio:0.1-0.3 表示「倍率在 0.1 到 0.3 之间的分组我都接受」，选路时在区间内
// 按价从低到高取分组，见 service.CacheGetRandomSatisfiedChannel。
//
// 这是与 "auto" 同类的伪分组：token.Group 存的不是真实分组名，真正用于计费的分组在选路
// 定下来之后通过 constant.ContextKeyAutoGroup 下发。因此本前缀是保留字，真实分组名不能
// 以它开头——否则那个分组永远选不中（解析发生在按分组名匹配之前）。
const TokenGroupRatioRangePrefix = "ratio:"

// ratioRangeSeparator 分隔区间的上下界，例如 ratio:0.1-0.3。
const ratioRangeSeparator = "-"

// RatioRange 是令牌里限定的倍率区间，闭区间 [Min, Max]，含两端。
//
// 用闭区间是因为用户写 0.1-0.3 时，倍率正好等于 0.1 和 0.3 的分组显然都是他要的；
// 半开会让「倍率正好等于上界」的分组从区间里神秘消失，而用户无从得知。
type RatioRange struct {
	Min float64
	Max float64
}

// Contains 报告某个倍率是否落在区间内（含两端）。
func (r RatioRange) Contains(ratio float64) bool {
	if math.IsNaN(ratio) || math.IsInf(ratio, 0) || ratio < 0 {
		return false
	}
	return ratio >= r.Min && ratio <= r.Max
}

// String 返回区间的归一写法，也就是令牌 group 字段里 ratio: 后面那一段的标准形式。
func (r RatioRange) String() string {
	return formatRatioBound(r.Min) + ratioRangeSeparator + formatRatioBound(r.Max)
}

// ParseTokenGroupRatioRange 解析 "ratio:0.1-0.3" 这种倍率区间令牌。三种返回：
//
//	(区间, true,  nil)   合法区间
//	(零值, true,  错误)  是区间写法但内容非法，错误文案可直接回给用户
//	(零值, false, nil)   不是区间写法，调用方按普通分组名处理
//
// 「是不是区间写法」只看前缀，不看有没有横杠：分组名里带横杠很常见（promo-a、gpt-4），
// 拿「含横杠」当判据会把它们统统判成非法区间。
func ParseTokenGroupRatioRange(tokenGroup string) (RatioRange, bool, error) {
	if !strings.HasPrefix(tokenGroup, TokenGroupRatioRangePrefix) {
		return RatioRange{}, false, nil
	}
	body := strings.TrimSpace(strings.TrimPrefix(tokenGroup, TokenGroupRatioRangePrefix))
	if body == "" {
		return RatioRange{}, true, fmt.Errorf("倍率区间为空，正确写法形如 %s0.1-0.3", TokenGroupRatioRangePrefix)
	}

	// 从第 1 个字符往后找分隔符：下标 0 上的 '-' 是负号而不是区间分隔符，
	// 这样 "-0.1-0.3" 才会被当成「下界为负」报错，而不是被切成空的左半段。
	offset := strings.Index(body[1:], ratioRangeSeparator)
	if offset < 0 {
		return RatioRange{}, true, fmt.Errorf("倍率区间 %q 缺少上下界分隔符，正确写法形如 %s0.1-0.3", body, TokenGroupRatioRangePrefix)
	}
	lower, upper := body[:offset+1], body[offset+2:]

	minValue, err := parseRatioBound(lower)
	if err != nil {
		return RatioRange{}, true, fmt.Errorf("倍率区间下界 %q 无效：%w", lower, err)
	}
	maxValue, err := parseRatioBound(upper)
	if err != nil {
		return RatioRange{}, true, fmt.Errorf("倍率区间上界 %q 无效：%w", upper, err)
	}
	if minValue > maxValue {
		return RatioRange{}, true, fmt.Errorf("倍率区间下界 %s 大于上界 %s", formatRatioBound(minValue), formatRatioBound(maxValue))
	}
	return RatioRange{Min: minValue, Max: maxValue}, true, nil
}

func parseRatioBound(text string) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil {
		return 0, fmt.Errorf("不是一个数字")
	}
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, fmt.Errorf("不是一个有限数字")
	}
	if value < 0 {
		return 0, fmt.Errorf("不能为负数")
	}
	return value, nil
}

// formatRatioBound 用最短且能精确还原的写法输出倍率，0.1375 不会变成 0.14 或 0.13750000000000001。
func formatRatioBound(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}
