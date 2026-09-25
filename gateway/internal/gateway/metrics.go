package gateway

import (
	"fmt"
	"io"
	"sync/atomic"
)

type gatewayMetrics struct {
	sessionsValidated uint64
	authReadySent     uint64
	resumesCompleted  uint64
	eventsSent        uint64
	connectionsClosed uint64
	authFailures      uint64
	protocolFailures  uint64
	eventFailures     uint64
}

func (m *gatewayMetrics) observe(stage string) {
	switch stage {
	case "session_validated":
		atomic.AddUint64(&m.sessionsValidated, 1)
	case "auth_ready_sent":
		atomic.AddUint64(&m.authReadySent, 1)
	case "resume_ready_sent":
		atomic.AddUint64(&m.resumesCompleted, 1)
	case "event_sent":
		atomic.AddUint64(&m.eventsSent, 1)
	}
}

func (m *gatewayMetrics) connectionClosed(class string) {
	atomic.AddUint64(&m.connectionsClosed, 1)
	switch class {
	case "auth":
		atomic.AddUint64(&m.authFailures, 1)
	case "protocol":
		atomic.AddUint64(&m.protocolFailures, 1)
	case "event_subscribe", "event_replay":
		atomic.AddUint64(&m.eventFailures, 1)
	}
}

func (m *gatewayMetrics) write(writer io.Writer, activeConnections, activeHandshakes int) error {
	values := []struct {
		name  string
		value uint64
	}{
		{"gram_wire_connections_active", uint64(activeConnections)},
		{"gram_wire_handshakes_active", uint64(activeHandshakes)},
		{"gram_wire_sessions_validated_total", atomic.LoadUint64(&m.sessionsValidated)},
		{"gram_wire_auth_ready_total", atomic.LoadUint64(&m.authReadySent)},
		{"gram_wire_resumes_completed_total", atomic.LoadUint64(&m.resumesCompleted)},
		{"gram_wire_events_sent_total", atomic.LoadUint64(&m.eventsSent)},
		{"gram_wire_connections_closed_total", atomic.LoadUint64(&m.connectionsClosed)},
		{"gram_wire_auth_failures_total", atomic.LoadUint64(&m.authFailures)},
		{"gram_wire_protocol_failures_total", atomic.LoadUint64(&m.protocolFailures)},
		{"gram_wire_event_failures_total", atomic.LoadUint64(&m.eventFailures)},
	}
	for _, value := range values {
		if _, err := fmt.Fprintf(writer, "%s %d\n", value.name, value.value); err != nil {
			return err
		}
	}
	return nil
}
