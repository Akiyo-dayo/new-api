package service

import (
	"fmt"
	"net/http"

	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet       = "wallet"
	BillingSourceSubscription = "subscription"
)

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo != nil && relayInfo.QuotaClamp != nil {
		return types.NewErrorWithStatusCode(
			relayInfo.QuotaClamp,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if preConsumedQuota < 0 {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("pre-consume quota cannot be negative: %d", preConsumedQuota),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	relayInfo.Billing = session
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
// SettleBilling 结算，并返回**用户实际被扣的额度**。
//
// 正常情况下返回值等于 actualQuota。结算失败时资金来源那一步没有提交，用户身上落下的
// 只有预扣额——消费日志与 used_quota 必须按返回值记而不是按 actualQuota，否则账面与
// 实扣不符；同时把失败记在 relayInfo.SettleFailure 上，日志的 admin_info 里会留痕，
// 事后能把这些请求捞出来补账。返回额度而不是让调用方自己算，是为了让"用错数"这件事
// 在类型上就做不到。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) (int, error) {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			charged := relayInfo.Billing.ChargedQuota(actualQuota)
			relayInfo.SettleFailure = &relaycommon.SettleFailure{
				ActualQuota: actualQuota, ChargedQuota: charged, Reason: err.Error(),
			}
			return charged, err
		}

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		return actualQuota, nil
	}

	// 回退：无 BillingSession 时使用旧路径
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		if err := PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true); err != nil {
			// 旧路径同样是「差额没补上，用户身上只剩预扣额」
			relayInfo.SettleFailure = &relaycommon.SettleFailure{
				ActualQuota:  actualQuota,
				ChargedQuota: relayInfo.FinalPreConsumedQuota,
				Reason:       err.Error(),
			}
			return relayInfo.FinalPreConsumedQuota, err
		}
	}
	return actualQuota, nil
}
