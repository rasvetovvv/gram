package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const sessionTestSecret = "test-wire-internal-secret-at-least-32-bytes"

func TestHTTPSessionValidatorAcceptsOnlyActiveStrictResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.Header.Get("X-Gram-Wire-Internal") != sessionTestSecret {
			response.WriteHeader(http.StatusForbidden)
			return
		}
		var payload map[string]string
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil ||
			payload["user_id"] != "user-1" || payload["session_id"] != "session-1" {
			response.WriteHeader(http.StatusBadRequest)
			return
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"active":true}`))
	}))
	defer server.Close()
	validator, err := NewHTTPSessionValidator(server.URL, sessionTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	if err := validator.Validate(context.Background(), "user-1", "session-1"); err != nil {
		t.Fatal(err)
	}
}

func TestHTTPSessionValidatorFailsClosed(t *testing.T) {
	responses := []struct {
		name string
		body string
		code int
	}{
		{name: "inactive", body: `{"active":false}`, code: http.StatusOK},
		{name: "unknown field", body: `{"active":true,"extra":1}`, code: http.StatusOK},
		{name: "trailing", body: `{"active":true}{}`, code: http.StatusOK},
		{name: "oversized", body: strings.Repeat("x", maxSessionCheckResponse+1), code: http.StatusOK},
		{name: "upstream error", body: `{}`, code: http.StatusServiceUnavailable},
	}
	for _, test := range responses {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
				response.WriteHeader(test.code)
				_, _ = response.Write([]byte(test.body))
			}))
			defer server.Close()
			validator, err := NewHTTPSessionValidator(server.URL, sessionTestSecret)
			if err != nil {
				t.Fatal(err)
			}
			if err := validator.Validate(context.Background(), "u", "s"); !errors.Is(err, ErrAuthenticationRequired) {
				t.Fatalf("got %v", err)
			}
		})
	}
}

func TestHTTPSessionValidatorRejectsRedirectAndBadConfiguration(t *testing.T) {
	redirectTarget := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("redirect was followed")
	}))
	defer redirectTarget.Close()
	redirect := httptest.NewServer(http.RedirectHandler(redirectTarget.URL, http.StatusTemporaryRedirect))
	defer redirect.Close()
	validator, err := NewHTTPSessionValidator(redirect.URL, sessionTestSecret)
	if err != nil {
		t.Fatal(err)
	}
	if err := validator.Validate(context.Background(), "u", "s"); !errors.Is(err, ErrAuthenticationRequired) {
		t.Fatalf("redirect result=%v", err)
	}
	for _, endpoint := range []string{"", "ftp://api/internal", "http://user:pass@api/internal", "http://api/internal?secret=x"} {
		if _, err := NewHTTPSessionValidator(endpoint, sessionTestSecret); err == nil {
			t.Fatalf("accepted endpoint %q", endpoint)
		}
	}
	if _, err := NewHTTPSessionValidator("http://api/internal", "short"); err == nil {
		t.Fatal("accepted short secret")
	}
}
