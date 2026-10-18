package controller

import (
	"net/http"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

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

	common.ApiSuccess(c, result)
}
