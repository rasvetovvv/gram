package wire

import (
	"errors"
	"testing"
)

func TestEnvelopeRoundTrip(t *testing.T) {
	input := Envelope{
		Version: EnvelopeVersion,
		Type:    "auth",
		ID:      7,
		Body:    map[string]any{"ticket": "signed"},
	}
	encoded, err := EncodeEnvelope(input)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := DecodeEnvelope(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.Type != "auth" || decoded.ID != 7 || decoded.Body["ticket"] != "signed" {
		t.Fatalf("unexpected envelope: %#v", decoded)
	}
}

func TestEnvelopeRejectsUnknownTypeAndTrailingPayload(t *testing.T) {
	if _, err := EncodeEnvelope(Envelope{Version: 1, Type: "exec", Body: map[string]any{}}); !errors.Is(err, ErrUnsupportedType) {
		t.Fatalf("got %v, want ErrUnsupportedType", err)
	}
	encoded, err := EncodeEnvelope(Envelope{Version: 1, Type: "ping", Body: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, 0xc0) // a second MessagePack value (nil)
	if _, err := DecodeEnvelope(encoded); !errors.Is(err, ErrMalformedEnvelope) {
		t.Fatalf("got %v, want ErrMalformedEnvelope", err)
	}
}
