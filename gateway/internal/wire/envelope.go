package wire

import (
	"bytes"
	"errors"
	"fmt"
	"io"

	"github.com/vmihailenco/msgpack/v5"
)

const EnvelopeVersion uint8 = 1

var (
	ErrMalformedEnvelope = errors.New("gram wire: malformed envelope")
	ErrUnsupportedType   = errors.New("gram wire: unsupported envelope type")
)

type Envelope struct {
	Version uint8          `msgpack:"v"`
	Type    string         `msgpack:"type"`
	ID      uint64         `msgpack:"id"`
	Body    map[string]any `msgpack:"body"`
}

var allowedEnvelopeTypes = map[string]struct{}{
	"auth": {}, "rpc": {}, "event": {}, "ack": {}, "resume": {},
	"ping": {}, "pong": {}, "error": {}, "ready": {}, "resync_required": {},
}

func EncodeEnvelope(envelope Envelope) ([]byte, error) {
	if err := validateEnvelope(envelope); err != nil {
		return nil, err
	}
	encoded, err := msgpack.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("gram wire: encode envelope: %w", err)
	}
	if len(encoded) > MaxCiphertext-32 {
		return nil, ErrFrameTooLarge
	}
	return encoded, nil
}

func DecodeEnvelope(encoded []byte) (Envelope, error) {
	var envelope Envelope
	decoder := msgpack.NewDecoder(bytes.NewReader(encoded))
	if err := decoder.Decode(&envelope); err != nil {
		return envelope, fmt.Errorf("%w: %v", ErrMalformedEnvelope, err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return envelope, ErrMalformedEnvelope
	}
	if err := validateEnvelope(envelope); err != nil {
		return envelope, err
	}
	return envelope, nil
}

func validateEnvelope(envelope Envelope) error {
	if envelope.Version != EnvelopeVersion || envelope.Type == "" {
		return ErrMalformedEnvelope
	}
	if _, ok := allowedEnvelopeTypes[envelope.Type]; !ok {
		return ErrUnsupportedType
	}
	if envelope.Body == nil {
		envelope.Body = map[string]any{}
	}
	return nil
}
