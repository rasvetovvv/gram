package gateway

import (
	"testing"
	"time"
)

func TestIPHandshakeLimiterBoundsAndResets(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	limiter := newIPHandshakeLimiter(now)
	for attempt := 0; attempt < maxHandshakesPerIP; attempt++ {
		if !limiter.Allow("127.0.0.1:1234", "203.0.113.7, 10.0.0.2", now) {
			t.Fatalf("attempt %d rejected early", attempt)
		}
	}
	if limiter.Allow("127.0.0.1:1234", "203.0.113.7, 10.0.0.2", now) {
		t.Fatal("rate limit not enforced")
	}
	if !limiter.Allow("127.0.0.1:1234", "203.0.113.7, 10.0.0.2", now.Add(time.Minute)) {
		t.Fatal("window did not reset")
	}
}

func TestIPHandshakeLimiterRejectsMalformedForwarding(t *testing.T) {
	limiter := newIPHandshakeLimiter(time.Now())
	for _, forwarded := range []string{"not-an-ip", "203.0.113.7,broken", "1,2,3,4,5,6,7,8,9"} {
		if limiter.Allow("127.0.0.1:1234", forwarded, time.Now()) {
			t.Fatalf("accepted malformed chain %q", forwarded)
		}
	}
	if limiter.Allow("broken", "", time.Now()) {
		t.Fatal("accepted malformed remote address")
	}
}

func TestConnectionSlotIsNonBlockingAndBounded(t *testing.T) {
	slots := make(chan struct{}, 1)
	if !tryAcquire(slots) || tryAcquire(slots) {
		t.Fatal("slot bound not enforced")
	}
	release(slots)
	if !tryAcquire(slots) {
		t.Fatal("released slot was not reusable")
	}
}
