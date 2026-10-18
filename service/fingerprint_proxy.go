package service

import (
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
)

// FingerprintHTTPClient uses the existing DNS-pinned dialer with mandatory public-only
// access. Unlike administrator-configured fetches, user API inspection cannot opt out.
func FingerprintHTTPClient() *http.Client {
	protection := &common.SSRFProtection{AllowedPorts: []int{443}, ApplyIPFilterForDomain: true}
	dialer := &protectedFetchDialer{
		resolver:      net.DefaultResolver,
		dialContext:   (&net.Dialer{Timeout: 15 * time.Second}).DialContext,
		getProtection: func() (*common.SSRFProtection, bool, error) { return protection, true, nil },
	}
	return &http.Client{
		Transport:     &http.Transport{DialContext: dialer.DialContext, TLSHandshakeTimeout: 15 * time.Second, ResponseHeaderTimeout: 250 * time.Second, DisableKeepAlives: true},
		Timeout:       250 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func ValidateFingerprintTarget(raw string, format string) error {
	target, err := url.Parse(raw)
	if err != nil {
		return err
	}
	if target.Scheme != "https" || target.User != nil || target.RawQuery != "" || target.Fragment != "" {
		return fmtFingerprintTargetError()
	}
	suffix := "/chat/completions"
	if format == "responses" {
		suffix = "/responses"
	} else if format == "anthropic" {
		suffix = "/messages"
	} else if format != "openai" {
		return fmtFingerprintTargetError()
	}
	if !strings.HasSuffix(target.Path, suffix) {
		return fmtFingerprintTargetError()
	}
	return (&common.SSRFProtection{AllowedPorts: []int{443}, ApplyIPFilterForDomain: true}).ValidateURL(raw)
}

func fmtFingerprintTargetError() error { return fmt.Errorf("invalid fingerprint API endpoint") }
