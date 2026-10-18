package service

import (
	"context"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestFingerprintBundledReferenceValidates(t *testing.T) {
	files := map[string][]byte{}
	for name := range fingerprintFiles {
		data, err := os.ReadFile(filepath.Join("..", "web", "public", "fingerprint", name))
		require.NoError(t, err)
		files[name] = data
	}
	_, count, err := validateFingerprintBundle(files)
	require.NoError(t, err)
	require.Equal(t, 60, count)
}

func TestFingerprintMidnightUsesShanghaiAcrossUTCDate(t *testing.T) {
	now := time.Date(2026, 10, 18, 15, 59, 59, 0, time.UTC)
	next := NextFingerprintMidnight(now)
	require.Equal(t, "2026-10-19T00:00:00+08:00", next.Format(time.RFC3339))
	require.Equal(t, time.Second, next.Sub(now))
	require.Equal(t, 24*time.Hour, NextFingerprintMidnight(next).Sub(next))
}
func TestFingerprintUpdatePublishesBoundPackageAndRetainsItOnFailures(t *testing.T) {
	commit := strings.Repeat("a", 40)
	bank := []byte(`{"built_at":"2026-10-18","models":[{"id":"model"}]}`)
	header := []byte(`{"schema":"shared-detector-v2","bank_built_at":"2026-10-18","model_ids":["model"]}`)
	detector := make([]byte, (4+len(header)+3)/4*4)
	binary.LittleEndian.PutUint32(detector, uint32(len(header)))
	copy(detector[4:], header)
	files := map[string][]byte{"bank.json": bank, "detector.bin": detector, "tokenizer_bank.json": []byte(`{"schema":"tokenizer-bank-v1","classes":[{}],"probes":[{}]}`), "unified_reference.jsonl": []byte("{}\n")}
	failure := ""
	manager := &FingerprintReferences{root: t.TempDir(), status: FingerprintReferenceStatus{Commit: FingerprintBuiltin, Enabled: true}}
	manager.download = func(_ context.Context, url string, _ int64) ([]byte, error) {
		if failure == "network" {
			return nil, errors.New("offline")
		}
		if strings.Contains(url, "/commits/") {
			return []byte(`{"sha":"` + commit + `"}`), nil
		}
		if strings.Contains(url, "/shared/") {
			if failure == "algorithm" && strings.Contains(url, commit) {
				return []byte("changed algorithm"), nil
			}
			return []byte("algorithm"), nil
		}
		for name, path := range fingerprintFiles {
			if strings.HasSuffix(url, path) {
				if failure == "invalid" && name == "detector.bin" {
					return []byte("bad"), nil
				}
				return files[name], nil
			}
		}
		return nil, errors.New("unexpected URL")
	}
	manager.Update(context.Background())
	require.Equal(t, "updated", manager.Status().State)
	require.Equal(t, commit, manager.Status().Commit)
	pointer := filepath.Join(manager.root, "current.json")
	data, err := os.ReadFile(pointer)
	require.NoError(t, err)
	var published FingerprintReferenceStatus
	require.NoError(t, common.Unmarshal(data, &published))
	require.Len(t, published.Files, 4)
	for _, kind := range []string{"network", "algorithm", "invalid"} {
		failure = kind
		commit = strings.Repeat("b", 40)
		manager.Update(context.Background())
		require.Equal(t, published.Commit, manager.Status().Commit)
		unchanged, err := os.ReadFile(pointer)
		require.NoError(t, err)
		require.Equal(t, data, unchanged)
	}
	commit = strings.Repeat("c", 40)
	failure = ""
	manager.Update(context.Background())
	require.Equal(t, commit, manager.Status().Commit)
	require.Equal(t, "updated", manager.Status().State)
}
func TestFingerprintRejectsMismatchedModelBinding(t *testing.T) {
	_, _, err := validateFingerprintBundle(map[string][]byte{"bank.json": []byte(`{"built_at":"date","models":[{"id":"a"}]}`), "detector.bin": []byte("bad")})
	require.Error(t, err)
}
