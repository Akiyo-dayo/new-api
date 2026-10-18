package service

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
	_ "time/tzdata"

	"github.com/QuantumNous/new-api/common"
)

const FingerprintBuiltin = "50a364bc686279094265f34f18f5501eac1d73f4"

var fingerprintCommitPattern = regexp.MustCompile(`^[a-f0-9]{40}$`)
var fingerprintFiles = map[string]string{"bank.json": "data/unified_bank.json", "detector.bin": "data/shared_detector.bin", "tokenizer_bank.json": "data/tokenizer_bank.json", "unified_reference.jsonl": "data/unified_reference.jsonl"}
var fingerprintAlgorithms = []string{"shared/fingerprint-core.js", "shared/shared-detector.ts", "shared/positional.ts", "shared/detector-codec.ts", "shared/challenge-browser.js", "shared/tokenizer-posterior.ts", "shared/tokenizer-bank.ts", "shared/tokenizer-probe.ts", "shared/tokenizer-usage.ts", "shared/detection.ts", "shared/completion.ts", "shared/completion-request.ts", "shared/throughput.ts"}

type FingerprintReferenceStatus struct {
	Commit    string            `json:"commit"`
	BuiltAt   string            `json:"built_at"`
	Models    int               `json:"models"`
	State     string            `json:"state"`
	LastCheck time.Time         `json:"last_check"`
	NextCheck time.Time         `json:"next_check"`
	Timezone  string            `json:"timezone"`
	Enabled   bool              `json:"enabled"`
	Files     map[string]string `json:"files"`
}
type FingerprintReferences struct {
	mu       sync.RWMutex
	check    sync.Mutex
	root     string
	builtin  fs.FS
	client   *http.Client
	status   FingerprintReferenceStatus
	download func(context.Context, string, int64) ([]byte, error)
}

var fingerprintReference *FingerprintReferences

func NextFingerprintMidnight(now time.Time) time.Time {
	zone, _ := time.LoadLocation("Asia/Shanghai")
	local := now.In(zone)
	return time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, zone)
}
func StartFingerprintReferences(ctx context.Context, builtin fs.FS) {
	root := os.Getenv("FINGERPRINT_REFERENCE_DIR")
	if root == "" {
		root = "data/fingerprint-reference"
	}
	manager := &FingerprintReferences{root: root, builtin: builtin, client: &http.Client{Timeout: 90 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}, status: FingerprintReferenceStatus{Commit: FingerprintBuiltin, State: "builtin", Timezone: "Asia/Shanghai", Enabled: common.GetEnvOrDefaultBool("FINGERPRINT_REFERENCE_AUTO_UPDATE", true), Files: map[string]string{}}}
	manager.download = manager.fetch
	if data, err := fs.ReadFile(builtin, "fingerprint/bank.json"); err == nil {
		var meta struct {
			BuiltAt string `json:"built_at"`
			Models  []any  `json:"models"`
		}
		if common.Unmarshal(data, &meta) == nil {
			manager.status.BuiltAt = meta.BuiltAt
			manager.status.Models = len(meta.Models)
		}
	}
	for name := range fingerprintFiles {
		if data, err := fs.ReadFile(builtin, "fingerprint/"+name); err == nil {
			hash := sha256.Sum256(data)
			manager.status.Files[name] = hex.EncodeToString(hash[:])
		}
	}
	if data, err := os.ReadFile(filepath.Join(root, "current.json")); err == nil {
		var saved FingerprintReferenceStatus
		if common.Unmarshal(data, &saved) == nil && fingerprintCommitPattern.MatchString(saved.Commit) {
			files := map[string][]byte{}
			valid := true
			for name := range fingerprintFiles {
				data, readErr := os.ReadFile(filepath.Join(root, saved.Commit, name))
				hash := sha256.Sum256(data)
				if readErr != nil || saved.Files[name] != hex.EncodeToString(hash[:]) {
					valid = false
					break
				}
				files[name] = data
			}
			if _, _, err := validateFingerprintBundle(files); valid && err == nil {
				saved.Enabled = manager.status.Enabled
				manager.status = saved
			}
		}
	}
	manager.status.NextCheck = NextFingerprintMidnight(time.Now())
	fingerprintReference = manager
	go func() {
		if manager.status.Enabled {
			manager.Update(ctx)
		}
		for {
			timer := time.NewTimer(time.Until(NextFingerprintMidnight(time.Now())))
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
				if manager.Status().Enabled {
					manager.Update(ctx)
				}
			}
		}
	}()
}
func (m *FingerprintReferences) Status() FingerprintReferenceStatus {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}
func FingerprintStatus() FingerprintReferenceStatus {
	if fingerprintReference == nil {
		return FingerprintReferenceStatus{Commit: FingerprintBuiltin, State: "builtin", Timezone: "Asia/Shanghai"}
	}
	return fingerprintReference.Status()
}
func FingerprintResource(commit, name string) ([]byte, error) {
	if !fingerprintCommitPattern.MatchString(commit) {
		return nil, fs.ErrNotExist
	}
	if _, ok := fingerprintFiles[name]; !ok {
		return nil, fs.ErrNotExist
	}
	if fingerprintReference == nil {
		return nil, fs.ErrNotExist
	}
	if commit == FingerprintBuiltin {
		return fs.ReadFile(fingerprintReference.builtin, "fingerprint/"+name)
	}
	return os.ReadFile(filepath.Join(fingerprintReference.root, commit, name))
}
func (m *FingerprintReferences) fetch(ctx context.Context, url string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "new-api-fingerprint-reference")
	response, err := m.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("reference HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("reference exceeds size limit")
	}
	return data, nil
}
func (m *FingerprintReferences) Update(ctx context.Context) {
	if !m.check.TryLock() {
		return
	}
	defer m.check.Unlock()
	now := time.Now()
	state := "failed"
	defer func() {
		m.mu.Lock()
		m.status.LastCheck = now
		m.status.NextCheck = NextFingerprintMidnight(now)
		m.status.State = state
		m.mu.Unlock()
	}()
	head, err := m.download(ctx, "https://api.github.com/repos/Ikaleio/lm-detector/commits/HEAD", 1<<20)
	if err != nil {
		return
	}
	var info struct {
		SHA string `json:"sha"`
	}
	if common.Unmarshal(head, &info) != nil || !fingerprintCommitPattern.MatchString(info.SHA) {
		return
	}
	if info.SHA == m.Status().Commit {
		state = "up_to_date"
		return
	}
	for _, path := range fingerprintAlgorithms {
		old, err := m.download(ctx, "https://raw.githubusercontent.com/Ikaleio/lm-detector/"+FingerprintBuiltin+"/"+path, 2<<20)
		if err != nil {
			return
		}
		fresh, err := m.download(ctx, "https://raw.githubusercontent.com/Ikaleio/lm-detector/"+info.SHA+"/"+path, 2<<20)
		if err != nil {
			return
		}
		if sha256.Sum256(old) != sha256.Sum256(fresh) {
			state = "compatibility_upgrade_required"
			return
		}
	}
	files := map[string][]byte{}
	for name, path := range fingerprintFiles {
		data, err := m.download(ctx, "https://raw.githubusercontent.com/Ikaleio/lm-detector/"+info.SHA+"/"+path, 64<<20)
		if err != nil {
			return
		}
		files[name] = data
	}
	built, models, err := validateFingerprintBundle(files)
	if err != nil {
		state = "validation_failed"
		return
	}
	if err := os.MkdirAll(m.root, 0700); err != nil {
		return
	}
	stage, err := os.MkdirTemp(m.root, "staging-")
	if err != nil {
		return
	}
	defer os.RemoveAll(stage)
	hashes := map[string]string{}
	for name, data := range files {
		if err := os.WriteFile(filepath.Join(stage, name), data, 0600); err != nil {
			return
		}
		hash := sha256.Sum256(data)
		hashes[name] = hex.EncodeToString(hash[:])
	}
	final := filepath.Join(m.root, info.SHA)
	if _, err := os.Stat(final); errors.Is(err, fs.ErrNotExist) {
		if os.Rename(stage, final) != nil {
			return
		}
	} else {
		for name, hash := range hashes {
			data, err := os.ReadFile(filepath.Join(final, name))
			actual := sha256.Sum256(data)
			if err != nil || hex.EncodeToString(actual[:]) != hash {
				state = "validation_failed"
				return
			}
		}
	}
	next := FingerprintReferenceStatus{Commit: info.SHA, BuiltAt: built, Models: models, State: "updated", LastCheck: now, NextCheck: NextFingerprintMidnight(now), Timezone: "Asia/Shanghai", Enabled: true, Files: hashes}
	data, err := common.Marshal(next)
	if err != nil {
		return
	}
	pointer, err := os.CreateTemp(m.root, "manifest-")
	if err != nil {
		return
	}
	tmp := pointer.Name()
	defer os.Remove(tmp)
	if _, err = pointer.Write(data); err != nil {
		pointer.Close()
		return
	}
	if pointer.Close() != nil {
		return
	}
	if os.Rename(tmp, filepath.Join(m.root, "current.json")) != nil {
		return
	}
	m.mu.Lock()
	m.status = next
	m.mu.Unlock()
	state = "updated"
}
func validateFingerprintBundle(files map[string][]byte) (string, int, error) {
	var bank struct {
		BuiltAt string `json:"built_at"`
		Models  []struct {
			ID string `json:"id"`
		} `json:"models"`
		ReferenceHash string `json:"reference_sha256"`
	}
	if common.Unmarshal(files["bank.json"], &bank) != nil || len(bank.Models) == 0 || bank.BuiltAt == "" {
		return "", 0, errors.New("invalid bank")
	}
	binaryData := files["detector.bin"]
	if len(binaryData) < 4 {
		return "", 0, errors.New("invalid detector")
	}
	length := int(binary.LittleEndian.Uint32(binaryData[:4]))
	start := (4 + length + 3) / 4 * 4
	if length < 1 || start > len(binaryData) || (len(binaryData)-start)%4 != 0 {
		return "", 0, errors.New("invalid detector header")
	}
	var detector struct {
		Schema        string   `json:"schema"`
		BuiltAt       string   `json:"bank_built_at"`
		Models        []string `json:"model_ids"`
		ReferenceHash string   `json:"source_reference_sha256"`
		BaseHash      string   `json:"base_sha256"`
		Calibration   struct {
			Binding struct {
				BaseHash      string   `json:"base_sha256"`
				ReferenceHash string   `json:"reference_sha256"`
				Models        []string `json:"model_ids"`
			} `json:"binding"`
		} `json:"calibration"`
	}
	if common.Unmarshal(binaryData[4:4+length], &detector) != nil || detector.Schema != "shared-detector-v2" || detector.BuiltAt != bank.BuiltAt {
		return "", 0, errors.New("incompatible detector")
	}
	if binding := detector.Calibration.Binding; binding.BaseHash != "" && (binding.BaseHash != detector.BaseHash || binding.ReferenceHash != detector.ReferenceHash || !slices.Equal(binding.Models, detector.Models)) {
		return "", 0, errors.New("calibration binding mismatch")
	}
	var tree any
	if common.Unmarshal(binaryData[4:4+length], &tree) != nil {
		return "", 0, errors.New("invalid detector tree")
	}
	if err := validateFingerprintOffsets(tree, (len(binaryData)-start)/4); err != nil {
		return "", 0, err
	}
	ids := make([]string, len(bank.Models))
	for i, model := range bank.Models {
		ids[i] = model.ID
	}
	if !slices.Equal(ids, detector.Models) {
		return "", 0, errors.New("model binding mismatch")
	}
	referenceHash := sha256.Sum256(files["unified_reference.jsonl"])
	actual := hex.EncodeToString(referenceHash[:])
	if detector.ReferenceHash != "" && detector.ReferenceHash != actual {
		return "", 0, errors.New("reference binding mismatch")
	}
	if bank.ReferenceHash != "" && bank.ReferenceHash != actual {
		return "", 0, errors.New("bank reference mismatch")
	}
	var tokenizer struct {
		Schema  string `json:"schema"`
		Classes []any  `json:"classes"`
		Probes  []any  `json:"probes"`
	}
	if common.Unmarshal(files["tokenizer_bank.json"], &tokenizer) != nil || tokenizer.Schema != "tokenizer-bank-v1" || len(tokenizer.Classes) == 0 || len(tokenizer.Probes) == 0 {
		return "", 0, errors.New("invalid tokenizer bank")
	}
	for _, line := range strings.Split(string(files["unified_reference.jsonl"]), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var sample map[string]any
		if common.Unmarshal([]byte(line), &sample) != nil {
			return "", 0, errors.New("invalid reference samples")
		}
	}
	return bank.BuiltAt, len(bank.Models), nil
}

func validateFingerprintOffsets(value any, count int) error {
	switch node := value.(type) {
	case map[string]any:
		if offset, exists := node["$f32"]; exists {
			start, startOK := offset.(float64)
			length, lengthOK := node["n"].(float64)
			if !startOK || !lengthOK || start < 0 || length < 0 || start != float64(int64(start)) || length != float64(int64(length)) || start+length > float64(count) {
				return errors.New("detector float offsets out of range")
			}
		}
		for _, child := range node {
			if err := validateFingerprintOffsets(child, count); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range node {
			if err := validateFingerprintOffsets(child, count); err != nil {
				return err
			}
		}
	}
	return nil
}
