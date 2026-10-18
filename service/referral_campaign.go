package service

import (
	"context"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

func prepareReferralRequest(info *relaycommon.RelayInfo) bool {
	if info == nil || info.RequestId == "" || info.BillingSource == BillingSourceSubscription || info.TaskRelayInfo != nil {
		return false
	}
	ready, err := model.PrepareReferralSpend(info.UserId, "request:"+info.RequestId)
	if err != nil {
		common.SysError(fmt.Sprintf("referral spend intent failed (request=%s): %v", info.RequestId, err))
	}
	return ready
}

func completeReferralRequest(info *relaycommon.RelayInfo, quota int) {
	if err := model.CompleteReferralSpend(info.UserId, "request:"+info.RequestId, quota); err != nil {
		common.SysError(fmt.Sprintf("referral spend completion failed (request=%s): %v", info.RequestId, err))
	}
}

// The task's persisted final amount is replayable; submissions are not spend.
func completeReferralTask(task *model.Task) {
	if task.ID == 0 || task.ReferralSettlementFailed || task.Status != model.TaskStatusSuccess || task.PrivateData.BillingSource == BillingSourceSubscription || task.Quota < 0 {
		return
	}
	key := fmt.Sprintf("task:%d", task.ID)
	ready, err := model.PrepareReferralSpend(task.UserId, key)
	if err != nil {
		common.SysError(fmt.Sprintf("referral task intent failed (task=%d): %v", task.ID, err))
		return
	}
	if !ready {
		return
	}
	if task.PrivateData.ReferralWalletFinal == nil {
		final := task.Quota
		task.PrivateData.ReferralWalletFinal = &final
		if err := model.DB.Model(task).Update("private_data", task.PrivateData).Error; err != nil {
			common.SysError(fmt.Sprintf("referral task final marker failed (task=%d): %v", task.ID, err))
			return
		}
	}
	err = model.CompleteReferralSpend(task.UserId, key, *task.PrivateData.ReferralWalletFinal)
	if err != nil {
		common.SysError(fmt.Sprintf("referral task completion failed (task=%d): %v", task.ID, err))
	}
}

// CompleteMidjourneyReferral records only a successful, billed legacy task.
func CompleteMidjourneyReferral(task *model.Midjourney) {
	if task == nil || task.Id == 0 || task.Status != "SUCCESS" || task.Quota <= 0 {
		return
	}
	key := fmt.Sprintf("mj:%d", task.Id)
	tracked, err := model.PrepareReferralSpend(task.UserId, key)
	if err == nil && tracked {
		err = model.CompleteReferralSpend(task.UserId, key, task.Quota)
	}
	if err != nil {
		common.SysError(fmt.Sprintf("referral Midjourney completion failed (task=%d): %v", task.Id, err))
	}
}

func StartReferralReconciler(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			if err := model.ReconcilePendingReferrals(); err != nil {
				common.SysError(fmt.Sprintf("referral reconciliation failed: %v", err))
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}
