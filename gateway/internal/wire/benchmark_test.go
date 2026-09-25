package wire

import (
	"crypto/ed25519"
	"crypto/rand"
	"testing"
	"time"
)

func benchmarkSessions(b *testing.B) (*Session, *Session) {
	b.Helper()
	_, identity, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		b.Fatal(err)
	}
	client, hello, err := NewClientHello(time.Now())
	if err != nil {
		b.Fatal(err)
	}
	serverHello, server, err := AcceptClientHello(hello, identity, time.Now(), time.Minute)
	if err != nil {
		b.Fatal(err)
	}
	clientSession, err := client.Finish(serverHello, identity.Public().(ed25519.PublicKey))
	if err != nil {
		b.Fatal(err)
	}
	return clientSession, server
}

func BenchmarkHandshake(b *testing.B) {
	_, identity, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		b.Fatal(err)
	}
	publicKey := identity.Public().(ed25519.PublicKey)
	b.ReportAllocs()
	for iteration := 0; iteration < b.N; iteration++ {
		now := time.Now()
		client, hello, startErr := NewClientHello(now)
		if startErr != nil {
			b.Fatal(startErr)
		}
		response, _, acceptErr := AcceptClientHello(hello, identity, now, time.Minute)
		if acceptErr != nil {
			b.Fatal(acceptErr)
		}
		if _, finishErr := client.Finish(response, publicKey); finishErr != nil {
			b.Fatal(finishErr)
		}
	}
}

func BenchmarkSealOpen1KiB(b *testing.B) {
	client, server := benchmarkSessions(b)
	payload := make([]byte, 1024)
	if _, err := rand.Read(payload); err != nil {
		b.Fatal(err)
	}
	b.SetBytes(int64(len(payload)))
	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		frame, err := client.Seal(payload)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := server.Open(frame); err != nil {
			b.Fatal(err)
		}
	}
}

func BenchmarkEnvelopeRoundTrip(b *testing.B) {
	envelope := Envelope{
		Version: EnvelopeVersion,
		Type:    "event",
		ID:      42,
		Body: map[string]any{
			"event_id":   uint64(99),
			"event_type": "chat.message_created",
			"payload":    map[string]any{"chat_id": "00000000-0000-0000-0000-000000000001"},
		},
	}
	b.ReportAllocs()
	for iteration := 0; iteration < b.N; iteration++ {
		encoded, err := EncodeEnvelope(envelope)
		if err != nil {
			b.Fatal(err)
		}
		if _, err := DecodeEnvelope(encoded); err != nil {
			b.Fatal(err)
		}
	}
}
