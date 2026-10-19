package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAvailabilityUserVisibility(t *testing.T) {
	db := modelManagementDB(t, "sqlite", "")
	require.NoError(t, db.AutoMigrate(&model.Log{}))
	old := setting.UserUsableGroups2JSONString()
	t.Cleanup(func() { require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(old)) })
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"public":"Public"}`))
	user := model.User{Username: "availability-reader", Group: "public", AffCode: "avail-reader"}
	require.NoError(t, db.Create(&user).Error)
	now := time.Now().Unix()
	require.NoError(t, db.Create(&[]model.Log{
		{Type: model.LogTypeConsume, ModelName: "visible-model", Group: "public", CreatedAt: now},
		{Type: model.LogTypeError, ModelName: "visible-model", Group: "public", ChannelId: 123, Content: "private upstream secret", CreatedAt: now},
		{Type: model.LogTypeError, ModelName: "visible-model", Group: "public", ChannelId: 456, Content: "another private upstream secret", CreatedAt: now},
		{Type: model.LogTypeConsume, ModelName: "hidden-model", Group: "private", CreatedAt: now},
	}).Error)
	for _, tc := range []struct {
		name  string
		role  int
		query string
		cells int
	}{
		{"user", common.RoleCommonUser, "", 1},
		{"user forbidden group", common.RoleCommonUser, "?group=private", 0},
		{"admin", common.RoleAdminUser, "", 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodGet, "/api/availability/matrix"+tc.query, nil)
			c.Set("id", user.Id)
			c.Set("role", tc.role)
			GetAvailabilityMatrix(c)
			var response struct {
				Success bool                     `json:"success"`
				Data    model.AvailabilityMatrix `json:"data"`
			}
			require.NoError(t, common.Unmarshal(w.Body.Bytes(), &response))
			require.True(t, response.Success, w.Body.String())
			assert.Len(t, response.Data.Cells, tc.cells)
			if tc.role < common.RoleAdminUser {
				assert.NotContains(t, w.Body.String(), "private upstream secret")
				assert.NotContains(t, w.Body.String(), "hidden-model")
				assert.NotContains(t, w.Body.String(), "channel_id")
				if tc.cells > 0 {
					require.Len(t, response.Data.Cells[0].RecentErrors, 1)
					assert.Equal(t, "Upstream request failed", response.Data.Cells[0].RecentErrors[0].Content)
				}
			} else {
				assert.Contains(t, w.Body.String(), "private upstream secret")
			}
		})
	}
}
