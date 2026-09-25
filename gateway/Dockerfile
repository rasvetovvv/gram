FROM golang:1.25.13-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/gram-wire ./cmd/gram-wire

FROM alpine:3.23
RUN addgroup -S -g 10001 gramwire && adduser -S -D -H -u 10001 -G gramwire gramwire
COPY --from=builder --chown=gramwire:gramwire /out/gram-wire /usr/local/bin/gram-wire
USER gramwire
EXPOSE 4001 5222
ENTRYPOINT ["/usr/local/bin/gram-wire"]
