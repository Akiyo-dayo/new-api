package service

import (
	"context"
	"net"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

type fingerprintResolver struct{ addresses []net.IPAddr }

func (r fingerprintResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return r.addresses, nil
}

func TestFingerprintProxyBlocksPrivateTargetsAndDNSRebinding(t *testing.T) {
	for _, target := range []string{"http://example.com/v1/messages", "https://127.0.0.1/v1/messages", "https://169.254.169.254/v1/messages", "https://[::1]/v1/messages", "https://example.com:8443/v1/messages", "https://user:secret@example.com/v1/messages", "https://example.com/v1/messages?key=secret"} {
		t.Run(target, func(t *testing.T) { require.Error(t, ValidateFingerprintTarget(target, "anthropic")) })
	}
	dialed := false
	dialer := &protectedFetchDialer{
		resolver:    fingerprintResolver{[]net.IPAddr{{IP: net.ParseIP("1.1.1.1")}, {IP: net.ParseIP("127.0.0.1")}}},
		dialContext: func(context.Context, string, string) (net.Conn, error) { dialed = true; return nil, nil },
		getProtection: func() (*common.SSRFProtection, bool, error) {
			return &common.SSRFProtection{AllowedPorts: []int{443}, ApplyIPFilterForDomain: true}, true, nil
		},
	}
	_, err := dialer.DialContext(context.Background(), "tcp", "example.com:443")
	require.Error(t, err)
	require.False(t, dialed, "mixed public/private DNS results must never be dialed")
	require.NotNil(t, FingerprintHTTPClient().CheckRedirect)
}
