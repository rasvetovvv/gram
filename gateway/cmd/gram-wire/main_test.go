package main

import (
	"crypto/ed25519"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

func TestSecretFromConfigurationSupportsFileAndRejectsAmbiguity(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte("file-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TEST_SECRET", "")
	t.Setenv("TEST_SECRET_FILE", path)
	value, err := secretFromConfiguration("TEST_SECRET", 64)
	if err != nil || value != "file-secret" {
		t.Fatalf("value=%q err=%v", value, err)
	}
	t.Setenv("TEST_SECRET", "environment-secret")
	if _, err := secretFromConfiguration("TEST_SECRET", 64); err == nil {
		t.Fatal("accepted two secret sources")
	}
}

func TestOptionalSecretFromConfiguration(t *testing.T) {
	t.Setenv("OPTIONAL_SECRET", "")
	t.Setenv("OPTIONAL_SECRET_FILE", "")
	value, configured, err := optionalSecretFromConfiguration("OPTIONAL_SECRET", 64)
	if err != nil || configured || value != "" {
		t.Fatalf("unset optional secret value=%q configured=%t err=%v", value, configured, err)
	}

	path := filepath.Join(t.TempDir(), "optional-secret")
	if err := os.WriteFile(path, []byte("optional-file-secret\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("OPTIONAL_SECRET_FILE", path)
	value, configured, err = optionalSecretFromConfiguration("OPTIONAL_SECRET", 64)
	if err != nil || !configured || value != "optional-file-secret" {
		t.Fatalf("file optional secret value=%q configured=%t err=%v", value, configured, err)
	}
}

func TestIdentityAcceptsSeedFromSecretFile(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = byte(index + 1)
	}
	path := filepath.Join(t.TempDir(), "identity")
	if err := os.WriteFile(path, []byte(base64.RawStdEncoding.EncodeToString(seed)), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("WIRE_IDENTITY_PRIVATE_KEY_B64", "")
	t.Setenv("WIRE_IDENTITY_PRIVATE_KEY_B64_FILE", path)
	identity, err := identityFromConfiguration()
	if err != nil {
		t.Fatal(err)
	}
	if len(identity) != ed25519.PrivateKeySize {
		t.Fatalf("private key length=%d", len(identity))
	}
}
