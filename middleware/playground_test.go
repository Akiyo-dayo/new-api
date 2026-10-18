package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundRequiresLiveSessionAndRejectsCrossOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name         string
		session, pat bool
		origin       string
		expected     int
	}{
		{"anonymous", false, false, "", 401},
		{"personal access token", true, true, "", 403},
		{"cross origin", true, false, "https://evil.example", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			engine := gin.New()
			engine.POST("/pg/responses", func(c *gin.Context) {
				if tc.session {
					c.Set("id", 1)
					c.Set("session_id", "test-session")
					c.Set("auth_version", int64(1))
					c.Set("session_version", int64(1))
				}
				c.Set("use_access_token", tc.pat)
			}, PlaygroundContext(), func(c *gin.Context) { t.Error("rejected request reached relay") })
			request := httptest.NewRequest("POST", "/pg/responses", strings.NewReader(`{"model":"test"}`))
			request.Header.Set("Content-Type", "application/json")
			if tc.origin != "" {
				request.Header.Set("Origin", tc.origin)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			assert.Equal(t, tc.expected, recorder.Code)
		})
	}
}

func TestPlaygroundContextPreservesGroupAndCanonicalMultipartPath(t *testing.T) {
	oldDB := model.DB
	oldType, oldLogType := common.MainDatabaseType(), common.LogDatabaseType()
	oldPath, oldMaster, oldRedis := common.SQLitePath, common.IsMasterNode, common.RedisEnabled
	common.SQLitePath = t.TempDir() + "/playground.db"
	common.IsMasterNode = false
	common.RedisEnabled = false
	t.Setenv("SQL_DSN", "")
	require.NoError(t, model.InitDB())
	db := model.DB
	require.NoError(t, db.AutoMigrate(&model.User{}))
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		require.NoError(t, err)
		require.NoError(t, sqlDB.Close())
		model.DB = oldDB
		common.SetDatabaseTypes(oldType, oldLogType)
		common.SQLitePath = oldPath
		common.IsMasterNode = oldMaster
		common.RedisEnabled = oldRedis
	})
	require.NoError(t, db.Create(&model.User{Id: 701, Username: "pg-context", Group: "default", Role: common.RoleRootUser, Status: common.UserStatusEnabled, AuthVersion: 1}).Error)
	engine := gin.New()
	engine.POST("/pg/images/generations", func(c *gin.Context) {
		c.Set("id", 701)
		c.Set("session_id", "session")
		c.Set("auth_version", int64(1))
		c.Set("session_version", int64(1))
		c.Set("role", common.RoleRootUser)
	}, PlaygroundContext(), func(c *gin.Context) {
		assert.Equal(t, "/v1/images/generations", c.Request.URL.Path)
		assert.Equal(t, "/v1/images/generations", c.Request.RequestURI)
		assert.Equal(t, common.RoleCommonUser, c.GetInt("role"))
		assert.Equal(t, "default", c.GetString("token_group"))
		c.Status(204)
	})
	for _, tc := range []struct {
		group  string
		status int
	}{{"default", 204}, {"nonexistent-forbidden-group", http.StatusForbidden}} {
		request := httptest.NewRequest("POST", "/pg/images/generations", strings.NewReader(`{"model":"image","group":"`+tc.group+`"}`))
		request.Header.Set("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		assert.Equal(t, tc.status, recorder.Code, recorder.Body.String())
	}
}
