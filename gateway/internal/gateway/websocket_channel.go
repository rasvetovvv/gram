package gateway

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"gram/gateway/internal/wire"
)

const wireSubprotocol = "gram-wire-v1"

type websocketChannel struct {
	conn    *websocket.Conn
	session *wire.Session
	writeMu sync.Mutex
}

func newWebSocketChannel(conn *websocket.Conn, session *wire.Session) *websocketChannel {
	conn.SetReadLimit(wire.MaxCiphertext + 8)
	return &websocketChannel{conn: conn, session: session}
}

func (c *websocketChannel) Read(ctx context.Context) ([]byte, error) {
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < readTimeout {
		_ = c.conn.SetReadDeadline(deadline)
	} else {
		_ = c.conn.SetReadDeadline(time.Now().Add(readTimeout))
	}
	kind, frame, err := c.conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	if kind != websocket.BinaryMessage {
		return nil, ErrProtocol
	}
	return c.session.Open(frame)
}

func (c *websocketChannel) Write(ctx context.Context, plaintext []byte) error {
	frame, err := c.session.Seal(plaintext)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if deadline, ok := ctx.Deadline(); ok && time.Until(deadline) < writeTimeout {
		_ = c.conn.SetWriteDeadline(deadline)
	} else {
		_ = c.conn.SetWriteDeadline(time.Now().Add(writeTimeout))
	}
	return c.conn.WriteMessage(websocket.BinaryMessage, frame)
}

func (c *websocketChannel) ChannelBinding() []byte { return c.session.ChannelBinding() }

func (c *websocketChannel) Close() error {
	deadline := time.Now().Add(time.Second)
	_ = c.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""), deadline)
	return c.conn.Close()
}

func hasSubprotocol(request *http.Request, wanted string) bool {
	for _, candidate := range websocket.Subprotocols(request) {
		if candidate == wanted {
			return true
		}
	}
	return false
}

func originAllowed(request *http.Request, allowed map[string]struct{}) bool {
	origin := request.Header.Get("Origin")
	if origin == "" {
		return false // browser clients always have Origin; native clients use TCP.
	}
	_, ok := allowed[origin]
	return ok
}

var errUpgradeRejected = errors.New("gram wire: websocket upgrade rejected")
