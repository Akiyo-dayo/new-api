package middleware

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

// PlaygroundContext authenticates through UserAuth first, then uses the normal
// relay pipeline without issuing or persisting an API key. Paths are registered
// explicitly by the router; clients cannot choose an arbitrary upstream URL.
func PlaygroundContext() gin.HandlerFunc {
	protection := new(http.CrossOriginProtection)
	return func(c *gin.Context) {
		c.Header("Cache-Control", "private, no-store")
		if c.GetBool("use_access_token") {
			abortWithOpenAiMessage(c, http.StatusForbidden, "a dashboard login session is required")
			return
		}
		if _, ok := GetSessionAuthIdentity(c); !ok {
			abortWithOpenAiMessage(c, http.StatusUnauthorized, "a dashboard login session is required")
			return
		}
		if err := protection.Check(c.Request); err != nil {
			abortWithOpenAiMessage(c, http.StatusForbidden, "Cross-origin playground requests are not allowed")
			return
		}
		user, err := model.GetUserCache(c.GetInt("id"))
		if err != nil {
			abortWithOpenAiMessage(c, http.StatusInternalServerError, "Failed to load user")
			return
		}
		user.WriteContext(c)
		group := user.Group
		if c.Request.Method == http.MethodPost {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<20)
			request, err := getModelFromRequest(c)
			if err != nil {
				abortWithOpenAiMessage(c, http.StatusBadRequest, "Invalid playground request")
				return
			}
			if request.Group != "" {
				group = request.Group
			}
			if group != user.Group && !service.GroupInUserUsableGroups(user.Group, group) {
				abortWithOpenAiMessage(c, http.StatusForbidden, "Group access denied")
				return
			}
			if !service.GroupHasConfiguredRatio(user.Group, group) {
				abortWithOpenAiMessage(c, http.StatusForbidden, "Group is not configured")
				return
			}
		}
		if err := SetupContextForToken(c, &model.Token{UserId: user.Id, Name: fmt.Sprintf("playground-%s", group), Group: group, UnlimitedQuota: true}); err != nil {
			c.AbortWithStatus(http.StatusInternalServerError)
			return
		}
		// A dashboard administrator still only accesses their own playground tasks.
		c.Set("role", common.RoleCommonUser)
		common.SetContextKey(c, constant.ContextKeyUsingGroup, group)
		originalPath, originalURI := c.Request.URL.Path, c.Request.RequestURI
		c.Request.URL.Path = "/v1/" + strings.TrimPrefix(originalPath, "/pg/")
		c.Request.RequestURI = c.Request.URL.RequestURI()
		defer func() { c.Request.URL.Path = originalPath; c.Request.RequestURI = originalURI }()
		c.Next()
	}
}
