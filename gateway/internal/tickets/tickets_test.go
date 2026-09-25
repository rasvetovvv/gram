package tickets

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

const testSecret = "test-wire-ticket-secret-at-least-32-bytes"

func makeTicket(t *testing.T, secret string, claims Claims, algorithm string) string {
	t.Helper()
	headerBytes, _ := json.Marshal(header{Algorithm: algorithm, Type: "JWT"})
	claimsBytes, _ := json.Marshal(claims)
	headerPart := base64.RawURLEncoding.EncodeToString(headerBytes)
	claimsPart := base64.RawURLEncoding.EncodeToString(claimsBytes)
	unsigned := headerPart + "." + claimsPart
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func validClaims(now time.Time) Claims {
	return Claims{
		Subject:   "user-1",
		SessionID: "session-1",
		ID:        "ticket-1",
		Type:      "wire_ticket",
		Audience:  "gram-wire",
		Issuer:    "gram-api",
		IssuedAt:  now.Unix(),
		NotBefore: now.Unix(),
		ExpiresAt: now.Add(time.Minute).Unix(),
	}
}

func TestValidateTicket(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	validator, err := NewValidator(testSecret, "gram-api")
	if err != nil {
		t.Fatal(err)
	}
	validator.now = func() time.Time { return now }
	claims, err := validator.Validate(makeTicket(t, testSecret, validClaims(now), "HS256"))
	if err != nil {
		t.Fatal(err)
	}
	if claims.Subject != "user-1" || claims.SessionID != "session-1" || claims.ID != "ticket-1" {
		t.Fatalf("unexpected claims: %#v", claims)
	}
}

func TestRejectsWrongKeyAlgorithmAudienceExpiryAndLifetime(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	validator, _ := NewValidator(testSecret, "gram-api")
	validator.now = func() time.Time { return now }

	tests := []struct {
		name      string
		secret    string
		algorithm string
		claims    Claims
	}{
		{"wrong key", "wrong-secret-that-is-still-long-enough-000", "HS256", validClaims(now)},
		{"wrong algorithm", testSecret, "none", validClaims(now)},
		{"expired", testSecret, "HS256", validClaims(now.Add(-2 * time.Minute))},
		{"long lifetime", testSecret, "HS256", func() Claims { c := validClaims(now); c.ExpiresAt = now.Add(2 * time.Minute).Unix(); return c }()},
		{"wrong audience", testSecret, "HS256", func() Claims { c := validClaims(now); c.Audience = "api"; return c }()},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := validator.Validate(makeTicket(t, tc.secret, tc.claims, tc.algorithm)); !errors.Is(err, ErrInvalid) {
				t.Fatalf("got %v, want ErrInvalid", err)
			}
		})
	}
}

func TestRejectsTamperAndMalformedToken(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	validator, _ := NewValidator(testSecret, "gram-api")
	validator.now = func() time.Time { return now }
	token := makeTicket(t, testSecret, validClaims(now), "HS256")
	for _, candidate := range []string{"", "a.b", token + "x", token + ".extra"} {
		if _, err := validator.Validate(candidate); !errors.Is(err, ErrInvalid) {
			t.Fatalf("candidate %q: got %v", candidate, err)
		}
	}
}

func TestValidatorFailsClosedOnWeakConfiguration(t *testing.T) {
	if _, err := NewValidator("short", "gram-api"); err == nil {
		t.Fatal("weak secret accepted")
	}
}

func TestValidateAcceptsAndSurfacesChannelBindingConfirmation(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	validator, err := NewValidator(testSecret, "gram-api")
	if err != nil {
		t.Fatal(err)
	}
	validator.now = func() time.Time { return now }
	claims := validClaims(now)
	claims.Confirmation = "abc123-channel-binding-digest"
	parsed, err := validator.Validate(makeTicket(t, testSecret, claims, "HS256"))
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Confirmation != "abc123-channel-binding-digest" {
		t.Fatalf("cnf not surfaced: %#v", parsed)
	}
}
