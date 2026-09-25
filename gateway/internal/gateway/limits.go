package gateway

import (
	"net"
	"strings"
	"sync"
	"time"
)

const (
	maxOpenConnections   = 4096
	maxActiveHandshakes  = 256
	maxHandshakesPerIP   = 60
	handshakeRateWindow  = time.Minute
	limiterSweepInterval = 5 * time.Minute
)

type fixedWindowEntry struct {
	windowStart time.Time
	count       int
}

type ipHandshakeLimiter struct {
	mu        sync.Mutex
	entries   map[string]fixedWindowEntry
	lastSweep time.Time
}

func newIPHandshakeLimiter(now time.Time) *ipHandshakeLimiter {
	return &ipHandshakeLimiter{entries: make(map[string]fixedWindowEntry), lastSweep: now}
}

func (l *ipHandshakeLimiter) Allow(remoteAddress, forwardedFor string, now time.Time) bool {
	host, _, err := net.SplitHostPort(remoteAddress)
	if err != nil || net.ParseIP(host) == nil {
		return false
	}
	if forwardedFor != "" {
		chain := strings.Split(forwardedFor, ",")
		if len(chain) > 8 {
			return false
		}
		for index, candidate := range chain {
			candidate = strings.TrimSpace(candidate)
			if net.ParseIP(candidate) == nil {
				return false
			}
			if index == 0 {
				host = candidate
			}
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	entry := l.entries[host]
	if entry.windowStart.IsZero() || now.Sub(entry.windowStart) >= handshakeRateWindow {
		entry = fixedWindowEntry{windowStart: now}
	}
	if entry.count >= maxHandshakesPerIP {
		return false
	}
	entry.count++
	l.entries[host] = entry
	if now.Sub(l.lastSweep) >= limiterSweepInterval {
		for ip, candidate := range l.entries {
			if now.Sub(candidate.windowStart) >= 2*handshakeRateWindow {
				delete(l.entries, ip)
			}
		}
		l.lastSweep = now
	}
	return true
}

func tryAcquire(slots chan struct{}) bool {
	select {
	case slots <- struct{}{}:
		return true
	default:
		return false
	}
}

func release(slots chan struct{}) { <-slots }
