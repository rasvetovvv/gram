package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateEndpointRequiresExactSecureWirePath(t *testing.T) {
	accepted, err := validateEndpoint("wss://vexory.xyz/wire")
	if err != nil || accepted != "wss://vexory.xyz/wire" {
		t.Fatalf("endpoint=%q err=%v", accepted, err)
	}
	for _, endpoint := range []string{
		"ws://vexory.xyz/wire",
		"wss://vexory.xyz/wire/extra",
		"wss://vexory.xyz/wire?ticket=secret",
		"wss://user@vexory.xyz/wire",
	} {
		if _, err := validateEndpoint(endpoint); err == nil {
			t.Fatalf("accepted invalid endpoint %q", endpoint)
		}
	}
}

func TestReadTicketRejectsMultilineAndOversizedInput(t *testing.T) {
	for _, value := range []string{"", "one\ntwo", strings.Repeat("x", maxTicketBytes+1)} {
		if _, err := readTicket(strings.NewReader(value)); err == nil {
			t.Fatalf("accepted invalid ticket input of length %d", len(value))
		}
	}
}

func TestReadIdentityPublicKey(t *testing.T) {
	public, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "pin")
	if err := os.WriteFile(path, []byte(base64.RawStdEncoding.EncodeToString(public)+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	decoded, err := readIdentityPublicKey(path)
	if err != nil || !public.Equal(decoded) {
		t.Fatalf("decoded key mismatch: %v", err)
	}
}
