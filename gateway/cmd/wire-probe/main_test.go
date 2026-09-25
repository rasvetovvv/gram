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

func TestReadTicketRejectsEmptyMultilineAndOversizedInput(t *testing.T) {
	for _, value := range []string{"", "one\ntwo", strings.Repeat("x", maxTicketBytes+1)} {
		if _, err := readTicket(strings.NewReader(value)); err == nil {
			t.Fatalf("accepted invalid ticket input of length %d", len(value))
		}
	}
	ticket, err := readTicket(strings.NewReader("signed-ticket\n"))
	if err != nil || ticket != "signed-ticket" {
		t.Fatalf("ticket=%q err=%v", ticket, err)
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
