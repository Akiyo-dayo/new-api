package controller

import (
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"net/http"
)

func FingerprintReferenceStatus(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, service.FingerprintStatus())
}
func FingerprintReferenceResource(c *gin.Context) {
	data, err := service.FingerprintResource(c.Param("commit"), c.Param("name"))
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	contentType := "application/json"
	if c.Param("name") == "detector.bin" {
		contentType = "application/octet-stream"
	}
	c.Header("Cache-Control", "public, max-age=31536000, immutable")
	c.Data(http.StatusOK, contentType, data)
}
