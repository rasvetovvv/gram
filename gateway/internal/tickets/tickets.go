package tickets

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
)

var ErrInvalid = errors.New("gram wire: invalid protocol ticket")

const maxTicketBytes = 4096

type Claims struct {
	Subject      string `json:"sub"`
	SessionID    string `json:"sid"`
	ID           string `json:"jti"`
	Type         string `json:"type"`
	Audience     string `json:"aud"`
	Issuer       string `json:"iss"`
	IssuedAt     int64  `json:"iat"`
	NotBefore    int64  `json:"nbf"`
	ExpiresAt    int64  `json:"exp"`
	Confirmation string `json:"cnf,omitempty"`
}

type header struct {
	Algorithm string `json:"alg"`
	Type      string `json:"typ"`
}

type Validator struct {
	secret []byte
	issuer string
	now    func() time.Time
}

func NewValidator(secret, issuer string) (*Validator, error) {
	if len(secret) < 32 || issuer == "" {
		return nil, errors.New("gram wire: ticket validator is not configured securely")
	}
	return &Validator{secret: []byte(secret), issuer: issuer, now: time.Now}, nil
}

func (v *Validator) Validate(encoded string) (*Claims, error) {
	if len(encoded) == 0 || len(encoded) > maxTicketBytes {
		return nil, ErrInvalid
	}
	parts := strings.Split(encoded, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] == "" || parts[2] == "" {
		return nil, ErrInvalid
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil || len(signature) != sha256.Size {
		return nil, ErrInvalid
	}
	mac := hmac.New(sha256.New, v.secret)
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return nil, ErrInvalid
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, ErrInvalid
	}
	var parsedHeader header
	if err := strictJSON(headerBytes, &parsedHeader); err != nil || parsedHeader.Algorithm != "HS256" || (parsedHeader.Type != "" && parsedHeader.Type != "JWT") {
		return nil, ErrInvalid
	}
	claimsBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, ErrInvalid
	}
	var claims Claims
	if err := strictJSON(claimsBytes, &claims); err != nil {
		return nil, ErrInvalid
	}
	if !v.validClaims(&claims) {
		return nil, ErrInvalid
	}
	return &claims, nil
}

func (v *Validator) validClaims(c *Claims) bool {
	if c.Type != "wire_ticket" || c.Audience != "gram-wire" || c.Issuer != v.issuer || c.Subject == "" || c.SessionID == "" || c.ID == "" {
		return false
	}
	if c.IssuedAt <= 0 || c.NotBefore <= 0 || c.ExpiresAt <= c.IssuedAt || c.ExpiresAt-c.IssuedAt > 60 {
		return false
	}
	now := v.now().Unix()
	const leeway int64 = 3
	return now+leeway >= c.NotBefore && now-leeway <= c.ExpiresAt && c.IssuedAt <= now+leeway
}

func strictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return ErrInvalid
	}
	return nil
}
