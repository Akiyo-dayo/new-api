package controller

import (
	"fmt"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestReferralCampaignDatabaseMatrix(t *testing.T) {
	require.NoError(t, i18n.Init())
	oldBatch := common.BatchUpdateEnabled
	common.BatchUpdateEnabled = false
	t.Cleanup(func() { common.BatchUpdateEnabled = oldBatch })
	payment := operation_setting.GetPaymentSetting()
	before := *payment
	payment.ComplianceConfirmed = true
	payment.ComplianceTermsVersion = "v1"
	t.Cleanup(func() { *payment = before })
	for _, dialect := range []struct{ kind, env string }{{"sqlite", ""}, {"mysql", "TEST_MYSQL_DSN"}, {"postgres", "TEST_POSTGRES_DSN"}} {
		t.Run(dialect.kind, func(t *testing.T) {
			if dialect.env != "" && os.Getenv(dialect.env) == "" {
				t.Skip("set " + dialect.env)
			}
			db := modelManagementDB(t, dialect.kind, os.Getenv(dialect.env))
			require.NoError(t, db.AutoMigrate(&model.Task{}, &model.Log{}, &model.Midjourney{}))
			oldInviterReward, oldInviteeReward := common.QuotaForInviter, common.QuotaForInvitee
			common.QuotaForInviter, common.QuotaForInvitee = 0, 0
			t.Cleanup(func() { common.QuotaForInviter, common.QuotaForInvitee = oldInviterReward, oldInviteeReward })
			for range 2 {
				require.NoError(t, db.AutoMigrate(&model.ReferralEnrollment{}, &model.ReferralSpend{}))
			}
			inviter := model.User{Username: "referrer", AffCode: "referrer", Status: common.UserStatusEnabled, Quota: 1000}
			require.NoError(t, db.Create(&inviter).Error)
			require.NoError(t, model.UpdateOption(operation_setting.ReferralCampaignOptionKey, `{"enabled":true,"threshold":"20","reward":"5"}`))
			invitee := model.User{Username: "referred", Password: "password-test-only", InviterId: inviter.Id, Status: common.UserStatusEnabled}
			require.NoError(t, invitee.Insert(inviter.Id))
			var enrollment model.ReferralEnrollment
			require.NoError(t, db.First(&enrollment, "invitee_id = ?", invitee.Id).Error)
			assert.EqualValues(t, 10000000, enrollment.ThresholdQuota)
			require.NoError(t, model.UpdateOption(operation_setting.ReferralCampaignOptionKey, `{"enabled":false,"threshold":"30","reward":"9"}`))
			tracked, err := model.PrepareReferralSpend(invitee.Id, "request:first")
			require.NoError(t, err)
			require.True(t, tracked)
			require.NoError(t, model.CompleteReferralSpend(invitee.Id, "request:first", 10000000))
			require.NoError(t, db.First(&inviter, inviter.Id).Error)
			assert.Zero(t, inviter.AffQuota, "disabled pauses awards")
			require.NoError(t, model.CompleteReferralSpend(invitee.Id, "request:first", 9999999))
			require.NoError(t, model.UpdateOption(operation_setting.ReferralCampaignOptionKey, `{"enabled":true,"threshold":"30","reward":"9"}`))
			require.NoError(t, model.ReconcileReferral(invitee.Id))
			require.NoError(t, db.First(&inviter, inviter.Id).Error)
			assert.Zero(t, inviter.AffQuota, "refund before award reduces progress")
			require.NoError(t, model.CompleteReferralSpend(invitee.Id, "request:first", 10000000))
			for range 2 {
				require.NoError(t, model.CompleteReferralSpend(invitee.Id, "request:first", 10000000))
			}
			require.NoError(t, db.First(&inviter, inviter.Id).Error)
			assert.Equal(t, 2500000, inviter.AffQuota, "registration snapshot, once only")
			assert.Equal(t, 2500000, inviter.AffHistoryQuota)
			require.NoError(t, inviter.TransferAffQuotaToQuota(2500000))
			assert.Equal(t, 2501000, inviter.Quota)
			assert.Zero(t, inviter.AffQuota)
			require.Error(t, inviter.TransferAffQuotaToQuota(2500000))
			require.Error(t, inviter.TransferAffQuotaToQuota(-1))
			summary, err := model.GetReferralSummary(inviter.Id)
			require.NoError(t, err)
			assert.EqualValues(t, 1, summary.Participants)
			assert.EqualValues(t, 1, summary.Awarded)
			assert.EqualValues(t, 2500000, summary.TotalRewardQuota)
			tracked, err = model.PrepareReferralSpend(inviter.Id, "request:historical")
			require.NoError(t, err)
			assert.False(t, tracked)
			for _, value := range []string{`{}`, `{"enabled":true,"threshold":"0","reward":"5"}`, `{"enabled":true,"threshold":"20","reward":"-1"}`, `{"enabled":true,"threshold":"NaN","reward":"5"}`, `{"enabled":true,"threshold":"999999999999999","reward":"5"}`} {
				require.Error(t, model.UpdateOption(operation_setting.ReferralCampaignOptionKey, value), value)
			}
			var response struct {
				Success bool
				Data    model.ReferralSummary
			}
			modelManagementRequest(t, GetReferralCampaignSummary, http.MethodGet, "/api/user/referral_campaign", nil, &response)
			assert.True(t, response.Success, fmt.Sprint(response))

			t.Run("wallet settlement excludes subscription and retries once", func(t *testing.T) {
				common.BatchUpdateEnabled = false
				user := model.User{Username: "walletref", Password: "test-password", InviterId: inviter.Id, Status: common.UserStatusEnabled}
				require.NoError(t, user.Insert(inviter.Id))
				require.NoError(t, model.IncreaseUserQuota(user.Id, 30000000, true))
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
				info := &relaycommon.RelayInfo{UserId: user.Id, RequestId: "sub-excluded", BillingSource: service.BillingSourceSubscription}
				_, _ = service.SettleBilling(ctx, info, 20000000)
				var events int64
				require.NoError(t, db.Model(&model.ReferralSpend{}).Where("invitee_id = ?", user.Id).Count(&events).Error)
				assert.Zero(t, events)
				info.BillingSource = service.BillingSourceWallet
				info.RequestId = "wallet-charge"
				info.IsPlayground = true
				charged, err := service.SettleBilling(ctx, info, 15000000)
				require.NoError(t, err)
				assert.Equal(t, 15000000, charged)
				require.NoError(t, model.ReconcileReferral(user.Id))
				require.NoError(t, db.First(&inviter, inviter.Id).Error)
				assert.Equal(t, 4500000, inviter.AffQuota)
			})
			t.Run("concurrent retries award once and failed award remains replayable", func(t *testing.T) {
				u := model.User{Username: "retryref", Password: "test-password", InviterId: inviter.Id, Status: common.UserStatusEnabled}
				require.NoError(t, u.Insert(inviter.Id))
				tracked, err := model.PrepareReferralSpend(u.Id, "request:concurrent")
				require.NoError(t, err)
				require.True(t, tracked)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", inviter.Id).Update("aff_quota", common.MaxWalletQuota).Error)
				require.Error(t, model.CompleteReferralSpend(u.Id, "request:concurrent", 15000000))
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", inviter.Id).Update("aff_quota", 0).Error)
				var wg sync.WaitGroup
				for range 4 {
					wg.Go(func() { _ = model.ReconcileReferral(u.Id) })
				}
				wg.Wait()
				require.NoError(t, model.ReconcileReferral(u.Id))
				require.NoError(t, db.First(&inviter, inviter.Id).Error)
				assert.Equal(t, 4500000, inviter.AffQuota)
				var enrollment model.ReferralEnrollment
				require.NoError(t, db.First(&enrollment, "invitee_id = ?", u.Id).Error)
				assert.NotZero(t, enrollment.AwardedAt)
			})
			t.Run("OAuth transaction snapshots eligibility and stacks registration rewards", func(t *testing.T) {
				common.QuotaForInviter = 1000000
				defer func() { common.QuotaForInviter = 0 }()
				u := model.User{Username: "oauthref", InviterId: inviter.Id, Status: common.UserStatusEnabled}
				require.NoError(t, db.Transaction(func(tx *gorm.DB) error { return u.InsertWithTx(tx, inviter.Id) }))
				u.FinalizeOAuthUserCreation(inviter.Id)
				var e model.ReferralEnrollment
				require.NoError(t, db.First(&e, "invitee_id = ?", u.Id).Error)
				require.NoError(t, db.First(&inviter, inviter.Id).Error)
				assert.Equal(t, 5500000, inviter.AffQuota)
				tracked, err := model.PrepareReferralSpend(u.Id, "oauth-event")
				require.NoError(t, err)
				require.True(t, tracked)
				require.NoError(t, model.CompleteReferralSpend(u.Id, "oauth-event", 15000000))
				require.NoError(t, db.First(&inviter, inviter.Id).Error)
				assert.Equal(t, 10000000, inviter.AffQuota)
				payment.ComplianceConfirmed = false
				require.Error(t, model.UpdateOption(operation_setting.ReferralCampaignOptionKey, `{"enabled":true,"threshold":"20","reward":"5"}`))
				payment.ComplianceConfirmed = true
			})
			t.Run("successful task marker is replayed without counting queued or subscription tasks", func(t *testing.T) {
				u := model.User{Username: "taskref", Password: "test-password", InviterId: inviter.Id, Status: common.UserStatusEnabled}
				require.NoError(t, u.Insert(inviter.Id))
				final := 15000000
				tasks := []model.Task{
					{TaskID: "ready", UserId: u.Id, Status: model.TaskStatusSuccess, Quota: final, PrivateData: model.TaskPrivateData{ReferralWalletFinal: &final}},
					{TaskID: "queued", UserId: u.Id, Status: model.TaskStatusInProgress, Quota: final},
					{TaskID: "subscription", UserId: u.Id, Status: model.TaskStatusSuccess, Quota: final, PrivateData: model.TaskPrivateData{BillingSource: service.BillingSourceSubscription, ReferralWalletFinal: &final}},
				}
				require.NoError(t, db.Create(&tasks).Error)
				for range 2 {
					require.NoError(t, model.ReconcilePendingReferrals())
				}
				var e model.ReferralEnrollment
				require.NoError(t, db.First(&e, "invitee_id = ?", u.Id).Error)
				assert.EqualValues(t, final, e.NetQuota)
				require.NoError(t, db.First(&inviter, inviter.Id).Error)
				assert.Equal(t, 14500000, inviter.AffQuota)
			})
			t.Run("blocked inviter and failed settlement do not award", func(t *testing.T) {
				u := model.User{Username: "blockedref", Password: "test-password", InviterId: inviter.Id, Status: common.UserStatusEnabled}
				require.NoError(t, u.Insert(inviter.Id))
				tracked, err := model.PrepareReferralSpend(u.Id, "blocked-event")
				require.NoError(t, err)
				require.True(t, tracked)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", inviter.Id).Update("status", common.UserStatusDisabled).Error)
				require.NoError(t, model.CompleteReferralSpend(u.Id, "blocked-event", 15000000))
				var e model.ReferralEnrollment
				require.NoError(t, db.First(&e, "invitee_id = ?", u.Id).Error)
				assert.Zero(t, e.AwardedAt)
				require.NoError(t, db.Model(&model.User{}).Where("id = ?", inviter.Id).Update("status", common.UserStatusEnabled).Error)
				ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
				ctx.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
				info := &relaycommon.RelayInfo{UserId: u.Id, RequestId: "failed-wallet", FinalPreConsumedQuota: 100}
				_, err = service.SettleBilling(ctx, info, 15000000)
				require.Error(t, err)
				var event model.ReferralSpend
				require.NoError(t, db.First(&event, "event_key = ?", "request:failed-wallet").Error)
				assert.False(t, event.Ready)
				require.NoError(t, db.Delete(&u).Error)
			})
			t.Run("registration disabled and duplicate enrollment", func(t *testing.T) {
				require.NoError(t, model.UpdateOption(operation_setting.ReferralCampaignOptionKey, operation_setting.DefaultReferralCampaign))
				u := model.User{Username: "offref", Password: "test-password", InviterId: inviter.Id}
				require.NoError(t, u.Insert(inviter.Id))
				tracked, err := model.PrepareReferralSpend(u.Id, "off")
				require.NoError(t, err)
				assert.False(t, tracked)
				duplicate := model.ReferralEnrollment{InviteeID: invitee.Id, InviterID: inviter.Id}
				require.Error(t, db.Create(&duplicate).Error)
			})
		})
	}
}
