#!/usr/bin/env bash
# Confirm the Gateway's TCP and admin ports are not published on the host.
set -uo pipefail
ss -ltn > /tmp/host-ports.txt 2>/dev/null || true
count=$(grep -cE '5222|4001' /tmp/host-ports.txt || true)
echo "host_listeners_on_gateway_ports=${count}"
grep -E '5222|4001' /tmp/host-ports.txt || echo "none"
rm -f /tmp/host-ports.txt
