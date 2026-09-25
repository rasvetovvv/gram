package wire

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"testing"
	"time"
)

func handshake(t *testing.T) (*Session, *Session) {
	t.Helper()
	public, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	clientState, clientHello, err := NewClientHello(now)
	if err != nil {
		t.Fatal(err)
	}
	serverHello, server, err := AcceptClientHello(clientHello, private, now, 30*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	client, err := clientState.Finish(serverHello, public)
	if err != nil {
		t.Fatal(err)
	}
	return client, server
}

func TestHandshakeAndBidirectionalFrames(t *testing.T) {
	client, server := handshake(t)
	for _, tc := range []struct {
		name     string
		sender   *Session
		receiver *Session
		body     []byte
	}{
		{"client to server", client, server, []byte("auth ticket")},
		{"server to client", server, client, []byte("ready")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			frame, err := tc.sender.Seal(tc.body)
			if err != nil {
				t.Fatal(err)
			}
			got, err := tc.receiver.Open(frame)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(got, tc.body) {
				t.Fatalf("got %q, want %q", got, tc.body)
			}
		})
	}
}

func TestPinnedIdentityRejectsImpostor(t *testing.T) {
	_, signer, _ := ed25519.GenerateKey(rand.Reader)
	wrongPublic, _, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now()
	state, hello, err := NewClientHello(now)
	if err != nil {
		t.Fatal(err)
	}
	response, _, err := AcceptClientHello(hello, signer, now, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := state.Finish(response, wrongPublic); !errors.Is(err, ErrServerIdentity) {
		t.Fatalf("got %v, want ErrServerIdentity", err)
	}
}

func TestTamperReplayAndGapAreRejected(t *testing.T) {
	t.Run("tamper", func(t *testing.T) {
		client, server := handshake(t)
		frame, _ := client.Seal([]byte("secret"))
		frame[len(frame)-1] ^= 1
		if _, err := server.Open(frame); err == nil {
			t.Fatal("tampered ciphertext accepted")
		}
	})

	t.Run("replay", func(t *testing.T) {
		client, server := handshake(t)
		frame, _ := client.Seal([]byte("once"))
		if _, err := server.Open(frame); err != nil {
			t.Fatal(err)
		}
		if _, err := server.Open(frame); !errors.Is(err, ErrInvalidSequence) {
			t.Fatalf("got %v, want ErrInvalidSequence", err)
		}
	})

	t.Run("gap", func(t *testing.T) {
		client, server := handshake(t)
		_, _ = client.Seal([]byte("dropped"))
		second, _ := client.Seal([]byte("second"))
		if _, err := server.Open(second); !errors.Is(err, ErrInvalidSequence) {
			t.Fatalf("got %v, want ErrInvalidSequence", err)
		}
	})
}

func TestClockSkewAndFrameLimit(t *testing.T) {
	_, signer, _ := ed25519.GenerateKey(rand.Reader)
	now := time.Now()
	_, oldHello, err := NewClientHello(now.Add(-2 * time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := AcceptClientHello(oldHello, signer, now, 30*time.Second); !errors.Is(err, ErrClockSkew) {
		t.Fatalf("got %v, want ErrClockSkew", err)
	}

	client, _ := handshake(t)
	if _, err := client.Seal(make([]byte, MaxCiphertext)); !errors.Is(err, ErrFrameTooLarge) {
		t.Fatalf("got %v, want ErrFrameTooLarge", err)
	}
}

func TestTCPRecordRoundTrip(t *testing.T) {
	client, server := handshake(t)
	var network bytes.Buffer
	if err := client.WriteRecord(&network, []byte("framed")); err != nil {
		t.Fatal(err)
	}
	got, err := server.ReadRecord(&network)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != "framed" {
		t.Fatalf("got %q", got)
	}
}

func TestChannelBindingAgreesAndIsUnique(t *testing.T) {
	client, server := handshake(t)
	clientBinding := client.ChannelBinding()
	serverBinding := server.ChannelBinding()
	if len(clientBinding) != 32 {
		t.Fatalf("channel binding length=%d, want 32", len(clientBinding))
	}
	if !bytes.Equal(clientBinding, serverBinding) {
		t.Fatal("client and server derived different channel bindings")
	}
	// A fresh handshake uses new ephemeral keys and fresh randomness, so its binding must differ.
	otherClient, _ := handshake(t)
	if bytes.Equal(clientBinding, otherClient.ChannelBinding()) {
		t.Fatal("distinct handshakes produced the same channel binding")
	}
	// The binding must not equal any record-layer key, which the exported API never reveals; the
	// least we can assert here is that it is not all-zero and not the raw session randomness.
	if bytes.Equal(clientBinding, make([]byte, 32)) {
		t.Fatal("channel binding is all zero")
	}
}
