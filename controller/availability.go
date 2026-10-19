package controller

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// GetAvailabilityMatrix returns the group x model availability matrix
// aggregated from consume/error logs within the requested window.
func GetAvailabilityMatrix(c *gin.Context) {
	hours := model.AvailabilityDefaultHours
	if rawHours := c.Query("hours"); rawHours != "" {
		parsed, err := strconv.Atoi(rawHours)
		if err != nil || parsed <= 0 {
			common.ApiErrorMsg(c, "Invalid hours parameter")
			return
		}
		hours = parsed
	}
	if hours > model.AvailabilityMaxHours {
		hours = model.AvailabilityMaxHours
	}

	result, err := model.GetAvailabilityMatrix(model.AvailabilityQuery{
		Hours: hours,
		Group: c.Query("group"),
		Model: c.Query("model"),
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	if c.GetInt("role") < common.RoleAdminUser {
		group, err := model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		allowed := service.GetUserUsableGroups(group)
		cells := make([]model.AvailabilityCell, 0, len(result.Cells))
		groups := make([]string, 0)
		models := make([]string, 0)
		groupSet := make(map[string]bool)
		modelSet := make(map[string]bool)
		for _, cell := range result.Cells {
			if _, ok := allowed[cell.Group]; !ok {
				continue
			}
			publicErrors := make([]model.AvailabilityRecentError, 0)
			seen := make(map[string]bool)
			for _, entry := range cell.RecentErrors {
				// Never expose raw upstream errors: they can embed channel names,
				// URLs or credentials. Coalesce identical public reasons per group.
				reason := "Upstream request failed"
				content := strings.ToLower(entry.Content)
				switch {
				case strings.Contains(content, "429"), strings.Contains(content, "rate limit"), strings.Contains(content, "quota"):
					reason = "Upstream capacity temporarily unavailable"
				case strings.Contains(content, "timeout"), strings.Contains(content, "timed out"):
					reason = "Upstream request timed out"
				case strings.Contains(content, "401"), strings.Contains(content, "403"), strings.Contains(content, "unauthorized"):
					reason = "Upstream access temporarily unavailable"
				case strings.Contains(content, "model not found"), strings.Contains(content, "unknown model"), strings.Contains(content, "unknown provider"):
					reason = "Requested model temporarily unavailable"
				}
				if !seen[reason] {
					publicErrors = append(publicErrors, model.AvailabilityRecentError{Content: reason, CreatedAt: entry.CreatedAt})
					seen[reason] = true
				}
			}
			cell.RecentErrors = publicErrors
			cells = append(cells, cell)
			groupSet[cell.Group] = true
			modelSet[cell.Model] = true
		}
		for _, group := range result.Groups {
			if groupSet[group] {
				groups = append(groups, group)
			}
		}
		for _, name := range result.Models {
			if modelSet[name] {
				models = append(models, name)
			}
		}
		result.Cells, result.Groups, result.Models = cells, groups, models
	}
	common.ApiSuccess(c, result)
}
