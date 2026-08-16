package controller

import (
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func GetRankings(c *gin.Context) {
	period := c.DefaultQuery("period", "week")
	mode := c.Query("mode")
	result, err := service.GetRankingsSnapshotForMode(period, mode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false,
			"message": err.Error(),
		})
		return
	}

	response := result
	if c.GetInt("role") == common.RoleRootUser {
		spending, spendingErr := service.GetUserSpendingRankingForMode(period, mode)
		if spendingErr != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"success": false,
				"message": spendingErr.Error(),
			})
			return
		}
		response = service.AttachRootUserSpending(result, c.GetInt("role"), spending)
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"data":    response,
	})
}
