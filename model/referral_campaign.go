package model

import (
	"errors"
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Each invitee can participate once, with rules frozen at registration.
type ReferralEnrollment struct {
	InviteeID      int   `json:"-" gorm:"primaryKey;autoIncrement:false"`
	InviterID      int   `json:"-" gorm:"not null;index:idx_referral_inviter"`
	ThresholdQuota int64 `json:"threshold_quota" gorm:"not null;type:bigint"`
	RewardQuota    int64 `json:"reward_quota" gorm:"not null;type:bigint"`
	NetQuota       int64 `json:"net_quota" gorm:"not null;type:bigint"`
	CreatedAt      int64 `json:"created_at" gorm:"not null;type:bigint"`
	AwardedAt      int64 `json:"awarded_at" gorm:"not null;type:bigint;index:idx_referral_awarded"`
}

// A pending event is deliberately NOT spend: a crash or uncertain settlement
// must not mint rewards. Ready events are durable and safe to replay.
type ReferralSpend struct {
	EventKey     string `json:"-" gorm:"primaryKey;type:varchar(96)"`
	InviteeID    int    `json:"-" gorm:"not null;index"`
	Quota        int64  `json:"-" gorm:"not null;type:bigint"`
	AppliedQuota int64  `json:"-" gorm:"not null;type:bigint"`
	Ready        bool   `json:"-" gorm:"not null"`
	CreatedAt    int64  `json:"-" gorm:"not null;type:bigint"`
}

func referralCampaign(tx *gorm.DB) (operation_setting.ReferralCampaign, int, int, error) {
	value := operation_setting.DefaultReferralCampaign
	common.OptionMapRWMutex.RLock()
	cached := common.OptionMap[operation_setting.ReferralCampaignOptionKey]
	common.OptionMapRWMutex.RUnlock()
	if cached == "" {
		return operation_setting.ParseReferralCampaign(value)
	}
	var option Option
	err := tx.Where(&Option{Key: operation_setting.ReferralCampaignOptionKey}).First(&option).Error
	if err == nil {
		value = option.Value
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return operation_setting.ReferralCampaign{}, 0, 0, err
	}
	return operation_setting.ParseReferralCampaign(value)
}

func GetReferralCampaign() (operation_setting.ReferralCampaign, error) {
	campaign, _, _, err := referralCampaign(DB)
	return campaign, err
}

func enrollReferral(tx *gorm.DB, user *User, inviterID int) error {
	if inviterID <= 0 {
		return nil
	}
	campaign, threshold, reward, err := referralCampaign(tx)
	if err != nil {
		return err
	}
	if !campaign.Enabled || !operation_setting.IsPaymentComplianceConfirmed() || inviterID <= 0 || inviterID == user.Id {
		return nil
	}
	var inviter User
	if err := tx.Select("id").Where("id = ? AND status = ?", inviterID, common.UserStatusEnabled).First(&inviter).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		return err
	}
	enrollment := ReferralEnrollment{InviteeID: user.Id, InviterID: inviterID, ThresholdQuota: int64(threshold), RewardQuota: int64(reward), CreatedAt: time.Now().Unix()}
	if err := tx.Create(&enrollment).Error; err != nil {
		return err
	}
	if common.QuotaForInviter == 0 {
		return tx.Model(&User{}).Where("id = ?", inviterID).Update("aff_count", gorm.Expr("aff_count + 1")).Error
	}
	return nil
}

func PrepareReferralSpend(userID int, key string) (bool, error) {
	var enrollment ReferralEnrollment
	err := DB.Select("invitee_id").Where("invitee_id = ? AND awarded_at = 0", userID).First(&enrollment).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if key == "" || len(key) > 96 {
		return false, fmt.Errorf("invalid referral event identity")
	}
	event := ReferralSpend{EventKey: key, InviteeID: userID, CreatedAt: time.Now().Unix()}
	result := DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&event)
	if result.Error != nil {
		return false, result.Error
	}
	var existing ReferralSpend
	if err := DB.First(&existing, "event_key = ?", key).Error; err != nil {
		return false, err
	}
	if existing.InviteeID != userID {
		return false, fmt.Errorf("referral event owner mismatch")
	}
	return true, nil
}

// CompleteReferralSpend receives the authoritative final wallet amount, not a
// billing estimate or a delta. Repeated completion cannot increase it twice.
func CompleteReferralSpend(userID int, key string, quota int) error {
	if quota < 0 || int64(quota) > common.MaxWalletQuota {
		return fmt.Errorf("invalid referral spend")
	}
	result := DB.Model(&ReferralSpend{}).Where("event_key = ? AND invitee_id = ?", key, userID).Updates(map[string]any{"quota": int64(quota), "ready": true})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		var count int64
		if err := DB.Model(&ReferralSpend{}).Where("event_key = ? AND invitee_id = ?", key, userID).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("referral spend intent missing")
		}
	}
	return ReconcileReferral(userID)
}

func ReconcileReferral(userID int) error {
	var award *ReferralEnrollment
	err := DB.Transaction(func(tx *gorm.DB) error {
		// A write first serializes SQLite too, where FOR UPDATE is unavailable.
		if err := tx.Model(&ReferralEnrollment{}).Where("invitee_id = ?", userID).UpdateColumn("net_quota", gorm.Expr("net_quota + 0")).Error; err != nil {
			return err
		}
		var enrollment ReferralEnrollment
		if err := lockForUpdate(tx).First(&enrollment, "invitee_id = ?", userID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		var events []ReferralSpend
		if err := lockForUpdate(tx).Where("invitee_id = ? AND ready = ? AND quota <> applied_quota", userID, true).Order("event_key").Find(&events).Error; err != nil {
			return err
		}
		for _, event := range events {
			delta := event.Quota - event.AppliedQuota
			if delta > 0 && enrollment.NetQuota > common.MaxWalletQuota-delta || delta < 0 && enrollment.NetQuota < -delta {
				return fmt.Errorf("referral progress overflow")
			}
			enrollment.NetQuota += delta
			if err := tx.Model(&ReferralSpend{}).Where("event_key = ?", event.EventKey).Update("applied_quota", event.Quota).Error; err != nil {
				return err
			}
		}
		if err := tx.Model(&enrollment).Update("net_quota", enrollment.NetQuota).Error; err != nil {
			return err
		}
		if enrollment.AwardedAt != 0 || enrollment.NetQuota < enrollment.ThresholdQuota || !operation_setting.IsPaymentComplianceConfirmed() {
			return nil
		}
		campaign, _, _, err := referralCampaign(tx)
		if err != nil || !campaign.Enabled {
			return err
		}
		var inviteeCount int64
		if err := tx.Model(&User{}).Where("id = ? AND status = ?", userID, common.UserStatusEnabled).Count(&inviteeCount).Error; err != nil {
			return err
		}
		if inviteeCount != 1 {
			return nil
		}
		var inviter User
		err = lockForUpdate(tx).Select("id", "status", "aff_quota", "aff_history").First(&inviter, enrollment.InviterID).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil
		}
		if err != nil {
			return err
		}
		if inviter.Status != common.UserStatusEnabled || inviter.Id == userID {
			return nil
		}
		if int64(inviter.AffQuota) > common.MaxWalletQuota-enrollment.RewardQuota || int64(inviter.AffHistoryQuota) > common.MaxWalletQuota-enrollment.RewardQuota {
			return fmt.Errorf("referral reward balance overflow")
		}
		if err := tx.Model(&User{}).Where("id = ?", inviter.Id).Updates(map[string]any{"aff_quota": gorm.Expr("aff_quota + ?", enrollment.RewardQuota), "aff_history": gorm.Expr("aff_history + ?", enrollment.RewardQuota)}).Error; err != nil {
			return err
		}
		if err := tx.Model(&enrollment).Update("awarded_at", time.Now().Unix()).Error; err != nil {
			return err
		}
		award = &enrollment
		return nil
	})
	if err == nil && award != nil {
		RecordLog(award.InviterID, LogTypeSystem, common.NewMessage("Referral spending reward {{quota}}", map[string]any{"quota": logger.FormatQuota(int(award.RewardQuota))}))
	}
	return err
}

func ReconcilePendingReferrals() error {
	var cursor int
	for {
		var ids []int
		if err := DB.Model(&ReferralEnrollment{}).Where("awarded_at = 0 AND invitee_id > ?", cursor).Order("invitee_id").Limit(100).Pluck("invitee_id", &ids).Error; err != nil {
			return err
		}
		if len(ids) == 0 {
			return nil
		}
		for _, id := range ids {
			var taskCursor int64
			for {
				var tasks []Task
				if err := DB.Model(&Task{}).Select("id", "user_id", "private_data").Where("user_id = ? AND status = ? AND id > ?", id, TaskStatusSuccess, taskCursor).Order("id").Limit(100).Find(&tasks).Error; err != nil {
					return err
				}
				if len(tasks) == 0 {
					break
				}
				taskCursor = tasks[len(tasks)-1].ID
				for _, task := range tasks {
					if task.PrivateData.ReferralWalletFinal == nil || task.PrivateData.BillingSource == "subscription" {
						continue
					}
					key := fmt.Sprintf("task:%d", task.ID)
					tracked, err := PrepareReferralSpend(id, key)
					if err == nil && tracked {
						err = CompleteReferralSpend(id, key, *task.PrivateData.ReferralWalletFinal)
					}
					if err != nil {
						common.SysError(fmt.Sprintf("referral task replay failed (task=%d): %v", task.ID, err))
					}
				}
			}
			var mjCursor int
			for {
				var tasks []Midjourney
				if err := DB.Select("id", "user_id", "quota").Where("user_id = ? AND status = ? AND billing_channel_id > 0 AND id > ?", id, "SUCCESS", mjCursor).Order("id").Limit(100).Find(&tasks).Error; err != nil {
					return err
				}
				if len(tasks) == 0 {
					break
				}
				mjCursor = tasks[len(tasks)-1].Id
				for _, task := range tasks {
					key := fmt.Sprintf("mj:%d", task.Id)
					tracked, err := PrepareReferralSpend(id, key)
					if err == nil && tracked {
						err = CompleteReferralSpend(id, key, task.Quota)
					}
					if err != nil {
						common.SysError(fmt.Sprintf("referral Midjourney replay failed (task=%d): %v", task.Id, err))
					}
				}
			}
			if err := ReconcileReferral(id); err != nil {
				common.SysError(fmt.Sprintf("referral reconciliation failed (invitee=%d): %v", id, err))
			}
		}
		cursor = ids[len(ids)-1]
	}
}

type ReferralSummary struct {
	Campaign         operation_setting.ReferralCampaign `json:"campaign"`
	Participants     int64                              `json:"participants"`
	Qualified        int64                              `json:"qualified"`
	Awarded          int64                              `json:"awarded"`
	TotalRewardQuota int64                              `json:"total_reward_quota"`
}

func GetReferralSummary(userID int) (ReferralSummary, error) {
	campaign, err := GetReferralCampaign()
	summary := ReferralSummary{Campaign: campaign}
	if err != nil {
		return summary, err
	}
	var rows []ReferralEnrollment
	if err := DB.Where("inviter_id = ?", userID).Find(&rows).Error; err != nil {
		return summary, err
	}
	for _, row := range rows {
		summary.Participants++
		if row.NetQuota >= row.ThresholdQuota {
			summary.Qualified++
		}
		if row.AwardedAt != 0 {
			summary.Awarded++
			summary.TotalRewardQuota += row.RewardQuota
		}
	}
	return summary, nil
}
