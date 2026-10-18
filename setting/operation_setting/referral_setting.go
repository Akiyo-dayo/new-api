package operation_setting

import (
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/shopspring/decimal"
)

const ReferralCampaignOptionKey = "ReferralCampaign"
const DefaultReferralCampaign = `{"enabled":false,"threshold":"20","reward":"5"}`

type ReferralCampaign struct {
	Enabled   bool   `json:"enabled"`
	Threshold string `json:"threshold"`
	Reward    string `json:"reward"`
}

// ParseReferralCampaign validates whole-document saves; amounts use site units,
// not the display currency's exchange rate.
func ParseReferralCampaign(value string) (ReferralCampaign, int, int, error) {
	var fields map[string]any
	if err := common.UnmarshalJsonStr(value, &fields); err != nil || len(fields) != 3 {
		return ReferralCampaign{}, 0, 0, fmt.Errorf("Invalid referral campaign settings")
	}
	enabled, ok := fields["enabled"].(bool)
	if !ok {
		return ReferralCampaign{}, 0, 0, fmt.Errorf("Invalid referral campaign settings")
	}
	var quotas [2]int
	var amounts [2]string
	for i, key := range []string{"threshold", "reward"} {
		text, ok := fields[key].(string)
		if !ok || len(text) > 32 || strings.TrimSpace(text) != text {
			return ReferralCampaign{}, 0, 0, fmt.Errorf("Invalid referral campaign amount")
		}
		amount, err := decimal.NewFromString(text)
		if err != nil || !amount.IsPositive() || amount.Exponent() < -6 || amount.Exponent() > 10 {
			return ReferralCampaign{}, 0, 0, fmt.Errorf("Invalid referral campaign amount")
		}
		units := amount.Mul(decimal.NewFromFloat(common.QuotaPerUnit))
		if !units.Equal(units.Truncate(0)) {
			return ReferralCampaign{}, 0, 0, fmt.Errorf("Referral campaign amount is below quota precision")
		}
		quotas[i], err = common.WalletQuotaFromDecimalStrict(units)
		if err != nil || quotas[i] <= 0 {
			return ReferralCampaign{}, 0, 0, fmt.Errorf("Invalid referral campaign amount")
		}
		amounts[i] = amount.String()
	}
	return ReferralCampaign{Enabled: enabled, Threshold: amounts[0], Reward: amounts[1]}, quotas[0], quotas[1], nil
}
