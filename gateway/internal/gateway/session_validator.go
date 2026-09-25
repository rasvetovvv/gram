package gateway

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

const maxSessionCheckResponse = 1024

type SessionValidator interface {
	Validate(ctx context.Context, userID, sessionID string) error
}

type HTTPSessionValidator struct {
	endpoint string
	secret   string
	client   *http.Client
}

func NewHTTPSessionValidator(endpoint, secret string) (*HTTPSessionValidator, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || len(secret) < 32 {
		return nil, errors.New("gram wire: invalid session validator configuration")
	}
	return &HTTPSessionValidator{
		endpoint: parsed.String(),
		secret:   secret,
		client: &http.Client{
			Timeout: 3 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return errors.New("gram wire: session check redirect rejected")
			},
		},
	}, nil
}

func (v *HTTPSessionValidator) Validate(ctx context.Context, userID, sessionID string) error {
	if userID == "" || sessionID == "" || len(userID) > 128 || len(sessionID) > 128 {
		return ErrAuthenticationRequired
	}
	body, err := json.Marshal(map[string]string{"user_id": userID, "session_id": sessionID})
	if err != nil {
		return ErrAuthenticationRequired
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, v.endpoint, bytes.NewReader(body))
	if err != nil {
		return ErrAuthenticationRequired
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Gram-Wire-Internal", v.secret)
	response, err := v.client.Do(request)
	if err != nil {
		return ErrAuthenticationRequired
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return ErrAuthenticationRequired
	}
	limited, err := io.ReadAll(io.LimitReader(response.Body, maxSessionCheckResponse+1))
	if err != nil || len(limited) > maxSessionCheckResponse {
		return ErrAuthenticationRequired
	}
	var result struct {
		Active bool `json:"active"`
	}
	decoder := json.NewDecoder(bytes.NewReader(limited))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&result); err != nil || !result.Active {
		return ErrAuthenticationRequired
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return ErrAuthenticationRequired
	}
	return nil
}
