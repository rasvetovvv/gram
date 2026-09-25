// Package wire implements the cryptographic record layer of GRAM Wire v1.
//
// It deliberately contains no chat or authentication policy. A successful handshake authenticates
// the gateway and creates directional keys; the caller must still require a short-lived application
// auth ticket as the first encrypted frame.
package wire

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"time"

	"golang.org/x/crypto/curve25519"
	"golang.org/x/crypto/hkdf"
)

const (
	Version         uint16 = 1
	ClientHelloSize        = 4 + 2 + 8 + 32 + 16
	ServerHelloSize        = 4 + 2 + 32 + 16 + ed25519.SignatureSize
	MaxCiphertext          = 1 << 20
)

var (
	magic              = [4]byte{'G', 'R', 'M', '1'}
	signatureLabel     = []byte("GRAM-WIRE-v1")
	hkdfInfo           = []byte("GRAM-WIRE-v1/session")
	channelBindingInfo = []byte("GRAM-WIRE-v1/channel-binding")

	ErrMalformedHello     = errors.New("gram wire: malformed hello")
	ErrUnsupportedVersion = errors.New("gram wire: unsupported version")
	ErrClockSkew          = errors.New("gram wire: client clock outside allowed skew")
	ErrServerIdentity     = errors.New("gram wire: server identity verification failed")
	ErrInvalidSequence    = errors.New("gram wire: invalid frame sequence")
	ErrFrameTooLarge      = errors.New("gram wire: frame too large")
)

type ClientHello struct {
	Version   uint16
	Timestamp int64
	PublicKey [32]byte
	Random    [16]byte
}

type ServerHello struct {
	Version   uint16
	PublicKey [32]byte
	Random    [16]byte
	Signature [ed25519.SignatureSize]byte
}

type ClientState struct {
	Hello      ClientHello
	PrivateKey [32]byte
	rawHello   []byte
}

type Direction byte

const (
	ClientToServer Direction = 1
	ServerToClient Direction = 2
)

// Session owns independent send/receive AEADs and monotonically increasing counters.
// A Session must be used by one reader and one writer at a time.
type Session struct {
	version        uint16
	send           cipher.AEAD
	receive        cipher.AEAD
	sendPrefix     [4]byte
	receivePrefix  [4]byte
	sendDirection  Direction
	recvDirection  Direction
	sendSeq        uint64
	receiveSeq     uint64
	channelBinding [32]byte
}

// ChannelBinding returns a 32-byte value that is identical on both peers of a completed
// handshake and unique to that handshake. It lets a higher layer tie a credential (the auth
// ticket) to this specific encrypted session, so a stolen ticket cannot be replayed on a
// different connection. It is derived from the shared secret with a dedicated HKDF label,
// so it never overlaps the record-layer keys.
func (s *Session) ChannelBinding() []byte {
	out := make([]byte, len(s.channelBinding))
	copy(out, s.channelBinding[:])
	return out
}

func NewClientHello(now time.Time) (*ClientState, []byte, error) {
	private, public, err := ephemeralKeypair()
	if err != nil {
		return nil, nil, err
	}
	state := &ClientState{PrivateKey: private}
	state.Hello.Version = Version
	state.Hello.Timestamp = now.Unix()
	state.Hello.PublicKey = public
	if _, err := io.ReadFull(rand.Reader, state.Hello.Random[:]); err != nil {
		return nil, nil, fmt.Errorf("client random: %w", err)
	}
	raw := marshalClientHello(state.Hello)
	state.rawHello = append([]byte(nil), raw...)
	return state, raw, nil
}

// AcceptClientHello validates the hello, signs the transcript and derives server-side keys.
func AcceptClientHello(raw []byte, identity ed25519.PrivateKey, now time.Time, maxSkew time.Duration) ([]byte, *Session, error) {
	hello, err := parseClientHello(raw)
	if err != nil {
		return nil, nil, err
	}
	if hello.Version != Version {
		return nil, nil, ErrUnsupportedVersion
	}
	clientTime := time.Unix(hello.Timestamp, 0)
	if clientTime.Before(now.Add(-maxSkew)) || clientTime.After(now.Add(maxSkew)) {
		return nil, nil, ErrClockSkew
	}
	private, public, err := ephemeralKeypair()
	if err != nil {
		return nil, nil, err
	}
	response := ServerHello{Version: Version, PublicKey: public}
	if _, err := io.ReadFull(rand.Reader, response.Random[:]); err != nil {
		return nil, nil, fmt.Errorf("server random: %w", err)
	}
	unsigned := marshalServerHello(response, false)
	transcript := transcript(raw, unsigned)
	copy(response.Signature[:], ed25519.Sign(identity, transcript))
	encoded := marshalServerHello(response, true)
	session, err := deriveSession(private, hello.PublicKey, hello.Random, response.Random, false)
	if err != nil {
		return nil, nil, err
	}
	return encoded, session, nil
}

// Finish verifies the pinned gateway identity before deriving client-side keys.
func (c *ClientState) Finish(raw []byte, pinned ed25519.PublicKey) (*Session, error) {
	response, unsigned, err := parseServerHello(raw)
	if err != nil {
		return nil, err
	}
	if response.Version != Version {
		return nil, ErrUnsupportedVersion
	}
	if len(pinned) != ed25519.PublicKeySize || !ed25519.Verify(pinned, transcript(c.rawHello, unsigned), response.Signature[:]) {
		return nil, ErrServerIdentity
	}
	return deriveSession(c.PrivateKey, response.PublicKey, c.Hello.Random, response.Random, true)
}

func (s *Session) Seal(plaintext []byte) ([]byte, error) {
	if len(plaintext)+s.send.Overhead() > MaxCiphertext {
		return nil, ErrFrameTooLarge
	}
	if s.sendSeq == ^uint64(0) {
		return nil, ErrInvalidSequence
	}
	s.sendSeq++
	seq := s.sendSeq
	nonce := makeNonce(s.sendPrefix, seq)
	aad := makeAAD(s.version, s.sendDirection, seq)
	ciphertext := s.send.Seal(nil, nonce[:], plaintext, aad)
	frame := make([]byte, 8+len(ciphertext))
	binary.BigEndian.PutUint64(frame[:8], seq)
	copy(frame[8:], ciphertext)
	return frame, nil
}

func (s *Session) Open(frame []byte) ([]byte, error) {
	if len(frame) < 8+s.receive.Overhead() || len(frame)-8 > MaxCiphertext {
		return nil, ErrFrameTooLarge
	}
	seq := binary.BigEndian.Uint64(frame[:8])
	if seq != s.receiveSeq+1 || seq == 0 {
		return nil, ErrInvalidSequence
	}
	nonce := makeNonce(s.receivePrefix, seq)
	aad := makeAAD(s.version, s.recvDirection, seq)
	plaintext, err := s.receive.Open(nil, nonce[:], frame[8:], aad)
	if err != nil {
		return nil, fmt.Errorf("gram wire: authenticate frame: %w", err)
	}
	s.receiveSeq = seq
	return plaintext, nil
}

// WriteRecord applies the TCP length prefix after encryption.
func (s *Session) WriteRecord(w io.Writer, plaintext []byte) error {
	frame, err := s.Seal(plaintext)
	if err != nil {
		return err
	}
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(frame)))
	if _, err := w.Write(length[:]); err != nil {
		return err
	}
	_, err = w.Write(frame)
	return err
}

func (s *Session) ReadRecord(r io.Reader) ([]byte, error) {
	var length [4]byte
	if _, err := io.ReadFull(r, length[:]); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(length[:])
	if size < uint32(8+s.receive.Overhead()) || size > MaxCiphertext+8 {
		return nil, ErrFrameTooLarge
	}
	frame := make([]byte, size)
	if _, err := io.ReadFull(r, frame); err != nil {
		return nil, err
	}
	return s.Open(frame)
}

func ephemeralKeypair() ([32]byte, [32]byte, error) {
	var private, public [32]byte
	if _, err := io.ReadFull(rand.Reader, private[:]); err != nil {
		return private, public, fmt.Errorf("ephemeral private key: %w", err)
	}
	pub, err := curve25519.X25519(private[:], curve25519.Basepoint)
	if err != nil {
		return private, public, fmt.Errorf("ephemeral public key: %w", err)
	}
	copy(public[:], pub)
	return private, public, nil
}

func deriveSession(private, peer [32]byte, clientRandom, serverRandom [16]byte, client bool) (*Session, error) {
	shared, err := curve25519.X25519(private[:], peer[:])
	if err != nil {
		return nil, fmt.Errorf("x25519: %w", err)
	}
	salt := append(append([]byte(nil), clientRandom[:]...), serverRandom[:]...)
	material := make([]byte, 72)
	if _, err := io.ReadFull(hkdf.New(sha256.New, shared, salt, hkdfInfo), material); err != nil {
		return nil, fmt.Errorf("hkdf: %w", err)
	}
	// A separate HKDF expansion, over the same shared secret but a distinct label, yields a value
	// both peers agree on and no third party can predict. It is not a record-layer key; it exists
	// only so the auth layer can bind its ticket to this handshake.
	var binding [32]byte
	if _, err := io.ReadFull(hkdf.New(sha256.New, shared, salt, channelBindingInfo), binding[:]); err != nil {
		return nil, fmt.Errorf("hkdf channel binding: %w", err)
	}
	c2s, err := newGCM(material[:32])
	if err != nil {
		return nil, err
	}
	s2c, err := newGCM(material[32:64])
	if err != nil {
		return nil, err
	}
	var c2sPrefix, s2cPrefix [4]byte
	copy(c2sPrefix[:], material[64:68])
	copy(s2cPrefix[:], material[68:72])
	if client {
		return &Session{Version, c2s, s2c, c2sPrefix, s2cPrefix, ClientToServer, ServerToClient, 0, 0, binding}, nil
	}
	return &Session{Version, s2c, c2s, s2cPrefix, c2sPrefix, ServerToClient, ClientToServer, 0, 0, binding}, nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func marshalClientHello(h ClientHello) []byte {
	out := make([]byte, ClientHelloSize)
	copy(out[:4], magic[:])
	binary.BigEndian.PutUint16(out[4:6], h.Version)
	binary.BigEndian.PutUint64(out[6:14], uint64(h.Timestamp))
	copy(out[14:46], h.PublicKey[:])
	copy(out[46:62], h.Random[:])
	return out
}

func parseClientHello(raw []byte) (ClientHello, error) {
	var h ClientHello
	if len(raw) != ClientHelloSize || !bytes.Equal(raw[:4], magic[:]) {
		return h, ErrMalformedHello
	}
	h.Version = binary.BigEndian.Uint16(raw[4:6])
	h.Timestamp = int64(binary.BigEndian.Uint64(raw[6:14]))
	copy(h.PublicKey[:], raw[14:46])
	copy(h.Random[:], raw[46:62])
	return h, nil
}

func marshalServerHello(h ServerHello, signed bool) []byte {
	size := ServerHelloSize
	if !signed {
		size -= ed25519.SignatureSize
	}
	out := make([]byte, size)
	copy(out[:4], magic[:])
	binary.BigEndian.PutUint16(out[4:6], h.Version)
	copy(out[6:38], h.PublicKey[:])
	copy(out[38:54], h.Random[:])
	if signed {
		copy(out[54:], h.Signature[:])
	}
	return out
}

func parseServerHello(raw []byte) (ServerHello, []byte, error) {
	var h ServerHello
	if len(raw) != ServerHelloSize || !bytes.Equal(raw[:4], magic[:]) {
		return h, nil, ErrMalformedHello
	}
	h.Version = binary.BigEndian.Uint16(raw[4:6])
	copy(h.PublicKey[:], raw[6:38])
	copy(h.Random[:], raw[38:54])
	copy(h.Signature[:], raw[54:])
	return h, append([]byte(nil), raw[:54]...), nil
}

func transcript(client, serverUnsigned []byte) []byte {
	out := make([]byte, 0, len(signatureLabel)+len(client)+len(serverUnsigned))
	out = append(out, signatureLabel...)
	out = append(out, client...)
	out = append(out, serverUnsigned...)
	return out
}

func makeNonce(prefix [4]byte, seq uint64) [12]byte {
	var nonce [12]byte
	copy(nonce[:4], prefix[:])
	binary.BigEndian.PutUint64(nonce[4:], seq)
	return nonce
}

func makeAAD(version uint16, direction Direction, seq uint64) []byte {
	aad := make([]byte, 4+2+1+8)
	copy(aad[:4], magic[:])
	binary.BigEndian.PutUint16(aad[4:6], version)
	aad[6] = byte(direction)
	binary.BigEndian.PutUint64(aad[7:], seq)
	return aad
}
