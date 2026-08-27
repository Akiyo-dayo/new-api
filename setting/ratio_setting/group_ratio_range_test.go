package ratio_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// 区间解析直接决定令牌能命中哪些分组，也就决定了用户被按什么价计费。
// 三态里最要紧的是「是区间写法但内容非法」必须报错而不是退化成普通分组名：
// 退化会让 ratio:0.3-0.1 这种写法被当成一个不存在的分组，报「无权访问」而不是说清区间写反了。
func TestParseTokenGroupRatioRange(t *testing.T) {
	tests := []struct {
		name       string
		tokenGroup string
		wantRange  bool
		wantErr    bool
		wantMin    float64
		wantMax    float64
	}{
		{name: "普通分组名", tokenGroup: "浅夜专属GPT", wantRange: false},
		{name: "带横杠的分组名不算区间", tokenGroup: "promo-a", wantRange: false},
		{name: "auto 伪分组不算区间", tokenGroup: "auto", wantRange: false},
		{name: "空分组名", tokenGroup: "", wantRange: false},

		{name: "正常区间", tokenGroup: "ratio:0.1-0.3", wantRange: true, wantMin: 0.1, wantMax: 0.3},
		{name: "上下界相等", tokenGroup: "ratio:0.18-0.18", wantRange: true, wantMin: 0.18, wantMax: 0.18},
		{name: "下界为零", tokenGroup: "ratio:0-0.2", wantRange: true, wantMin: 0, wantMax: 0.2},
		{name: "整数写法", tokenGroup: "ratio:1-2", wantRange: true, wantMin: 1, wantMax: 2},
		{name: "两侧空白", tokenGroup: "ratio: 0.1375 - 0.275 ", wantRange: true, wantMin: 0.1375, wantMax: 0.275},

		{name: "空区间", tokenGroup: "ratio:", wantRange: true, wantErr: true},
		{name: "缺分隔符", tokenGroup: "ratio:0.3", wantRange: true, wantErr: true},
		{name: "上下界写反", tokenGroup: "ratio:0.3-0.1", wantRange: true, wantErr: true},
		{name: "下界为负", tokenGroup: "ratio:-0.1-0.3", wantRange: true, wantErr: true},
		{name: "上界不是数字", tokenGroup: "ratio:0.1-abc", wantRange: true, wantErr: true},
		{name: "下界不是数字", tokenGroup: "ratio:abc-0.3", wantRange: true, wantErr: true},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ratioRange, isRange, err := ParseTokenGroupRatioRange(tc.tokenGroup)
			require.Equal(t, tc.wantRange, isRange)
			if !tc.wantRange {
				require.NoError(t, err)
				return
			}
			if tc.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.wantMin, ratioRange.Min)
			assert.Equal(t, tc.wantMax, ratioRange.Max)
		})
	}
}

// 区间是闭区间：用户写 0.1-0.3 时，倍率正好等于两端的分组必须都在里面。
// 半开会让「倍率正好等于上界」的分组从区间里消失，而用户无从得知。
func TestRatioRangeContainsIsInclusive(t *testing.T) {
	ratioRange := RatioRange{Min: 0.1, Max: 0.3}

	assert.True(t, ratioRange.Contains(0.1))
	assert.True(t, ratioRange.Contains(0.3))
	assert.True(t, ratioRange.Contains(0.2))
	assert.False(t, ratioRange.Contains(0.0999))
	assert.False(t, ratioRange.Contains(0.3001))
	assert.False(t, ratioRange.Contains(-1))
}

// 归一写法要能精确还原用户填的数：0.1375 变成 0.14 会把用户挡在自己选中的分组之外，
// 而错误文案里显示的还是他没写过的数字。
func TestRatioRangeStringRoundTrips(t *testing.T) {
	original := RatioRange{Min: 0.1375, Max: 0.275}

	parsed, isRange, err := ParseTokenGroupRatioRange(TokenGroupRatioRangePrefix + original.String())
	require.True(t, isRange)
	require.NoError(t, err)
	assert.Equal(t, original, parsed)
	assert.Equal(t, "0.1375-0.275", original.String())
}
