package controller

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

func FingerprintProxy(c *gin.Context) {
	var input struct {
		URL    string         `json:"url"`
		Format string         `json:"format"`
		Body   map[string]any `json:"body"`
		Key    string         `json:"key"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
	if err := common.DecodeJson(c.Request.Body, &input); err != nil {
		c.JSON(400, gin.H{"error": gin.H{"message": "Invalid inspection request"}})
		return
	}
	if input.Key == "" || strings.ContainsAny(input.Key, "\r\n") {
		c.JSON(400, gin.H{"error": gin.H{"message": "Missing API credential"}})
		return
	}
	if err := service.ValidateFingerprintTarget(input.URL, input.Format); err != nil {
		c.JSON(400, gin.H{"error": gin.H{"message": "API endpoint must be public HTTPS on port 443"}})
		return
	}
	// This endpoint does not accept arbitrary relay tools, callbacks or files.
	for field := range input.Body {
		switch field {
		case "model", "messages", "input", "stream", "stream_options", "store", "reasoning", "reasoning_effort", "output_config", "thinking", "service_tier", "speed", "max_tokens":
		default:
			c.JSON(400, gin.H{"error": gin.H{"message": "Unsupported inspection field"}})
			return
		}
	}
	if limit, ok := input.Body["max_tokens"]; ok {
		number, valid := limit.(float64)
		if !valid || number < 1 || number > 8192 {
			c.JSON(400, gin.H{"error": gin.H{"message": "Invalid output limit"}})
			return
		}
	}
	payload, err := common.Marshal(input.Body)
	if err != nil {
		c.Status(400)
		return
	}
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, input.URL, bytes.NewReader(payload))
	if err != nil {
		c.Status(400)
		return
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if input.Format == "anthropic" {
		request.Header.Set("x-api-key", input.Key)
		request.Header.Set("anthropic-version", "2023-06-01")
		if _, ok := input.Body["speed"]; ok {
			request.Header.Set("anthropic-beta", "fast-mode-2026-02-01")
		}
	} else {
		request.Header.Set("Authorization", "Bearer "+input.Key)
	}
	client := service.FingerprintHTTPClient()
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		c.JSON(502, gin.H{"error": gin.H{"message": "Unable to reach inspection API"}})
		return
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 && response.StatusCode < 400 {
		c.JSON(502, gin.H{"error": gin.H{"message": "API redirects are not allowed"}})
		return
	}
	contentType := response.Header.Get("Content-Type")
	if !strings.Contains(contentType, "application/json") && !strings.Contains(contentType, "text/event-stream") {
		c.JSON(502, gin.H{"error": gin.H{"message": "Upstream did not return JSON or SSE"}})
		return
	}
	c.Header("Content-Type", contentType)
	c.Header("Cache-Control", "no-store")
	c.Header("X-Accel-Buffering", "no")
	c.Status(response.StatusCode)
	buffer := make([]byte, 16<<10)
	remaining := int64(8 << 20)
	for remaining > 0 {
		n, readErr := response.Body.Read(buffer)
		if n > 0 {
			remaining -= int64(n)
			if _, err := c.Writer.Write(buffer[:n]); err != nil {
				return
			}
			c.Writer.Flush()
		}
		if readErr != nil {
			if readErr != io.EOF {
				return
			}
			break
		}
	}
}
