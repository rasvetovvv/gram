package gateway

import (
	"context"
	"net"
	"sync"
	"time"

	"gram/gateway/internal/wire"
)

const (
	handshakeTimeout = 10 * time.Second
	readTimeout      = 75 * time.Second
	writeTimeout     = 10 * time.Second
)

type tcpChannel struct {
	conn    net.Conn
	session *wire.Session
	writeMu sync.Mutex
}

func newTCPChannel(conn net.Conn, session *wire.Session) *tcpChannel {
	return &tcpChannel{conn: conn, session: session}
}

func (c *tcpChannel) Read(ctx context.Context) ([]byte, error) {
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < readTimeout {
		_ = c.conn.SetReadDeadline(deadline)
	} else {
		_ = c.conn.SetReadDeadline(time.Now().Add(readTimeout))
	}
	return c.session.ReadRecord(c.conn)
}

func (c *tcpChannel) Write(ctx context.Context, plaintext []byte) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < writeTimeout {
		_ = c.conn.SetWriteDeadline(deadline)
	} else {
		_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	}
	return c.session.WriteRecord(c.conn, plaintext)
}

func (c *tcpChannel) ChannelBinding() []byte { return c.session.ChannelBinding() }

func (c *tcpChannel) Close() error { return c.conn.Close() }
