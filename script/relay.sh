#!/usr/bin/env bash
# relay.sh — Relay CCTP V2 message từ Base Sepolia → Arc Testnet
#
# Usage:
#   PRIVATE_KEY=0x... \
#   ARC_TESTNET_RPC=https://... \
#   ARC_MSG_TRANSMITTER=0x... \
#   ./script/relay.sh <BURN_TX_HASH>
#
# Env vars bắt buộc:
#   PRIVATE_KEY          — khóa bí mật của relayer (ai cũng relay được, không cần là user)
#   ARC_TESTNET_RPC      — RPC endpoint của Arc Testnet
#   ARC_MSG_TRANSMITTER  — địa chỉ MessageTransmitter CCTP V2 trên Arc Testnet
#
# Yêu cầu: cast (Foundry), curl, jq

set -euo pipefail

TX_HASH="${1:?Usage: relay.sh <BURN_TX_HASH>}"

# ── Config ────────────────────────────────────────────────────────────────
ARC_RPC="${ARC_TESTNET_RPC:?set ARC_TESTNET_RPC}"
ARC_MSG_TRANSMITTER="${ARC_MSG_TRANSMITTER:?set ARC_MSG_TRANSMITTER}"
IRIS_API="https://iris-api-sandbox.circle.com/v2/messages"
BASE_DOMAIN=6    # CCTP domain ID của Base Sepolia
POLL_INTERVAL=15 # giây giữa mỗi lần poll
MAX_RETRIES=40   # tối đa ~10 phút

# ── Step 1: Poll Circle attestation API ─────────────────────────────────────
echo "→ Polling Circle iris API..."
echo "  tx=$TX_HASH  domain=$BASE_DOMAIN"

MESSAGE=""
ATTESTATION=""

for i in $(seq 1 "$MAX_RETRIES"); do
  RESPONSE=$(curl -sf "${IRIS_API}/${BASE_DOMAIN}?transactionHash=${TX_HASH}" || echo '{}')
  STATUS=$(echo "$RESPONSE" | jq -r '.messages[0].status // empty')

  case "$STATUS" in
    complete)
      MESSAGE=$(echo "$RESPONSE"     | jq -r '.messages[0].message')
      ATTESTATION=$(echo "$RESPONSE" | jq -r '.messages[0].attestation')
      echo "✓ Attestation sẵn sàng (poll $i/$MAX_RETRIES)."
      break
      ;;
    pending_confirmations)
      echo "  [$i/$MAX_RETRIES] Đang chờ đủ block confirmations..."
      ;;
    pending)
      echo "  [$i/$MAX_RETRIES] Đang chờ Circle ký attestation..."
      ;;
    "")
      echo "  [$i/$MAX_RETRIES] Message chưa index — tx có thể chưa finalized..."
      ;;
    *)
      echo "  [$i/$MAX_RETRIES] status=$STATUS"
      ;;
  esac

  sleep "$POLL_INTERVAL"
done

if [[ -z "$MESSAGE" || "$MESSAGE" == "null" ]]; then
  echo "❌ Không lấy được message sau $((MAX_RETRIES * POLL_INTERVAL))s." >&2
  exit 1
fi

if [[ -z "$ATTESTATION" || "$ATTESTATION" == "null" ]]; then
  echo "❌ Không lấy được attestation sau $((MAX_RETRIES * POLL_INTERVAL))s." >&2
  exit 1
fi

echo "   message:     ${MESSAGE:0:66}..."
echo "   attestation: ${ATTESTATION:0:66}..."

# ── Step 2: Submit receiveMessage trên Arc Testnet ──────────────────────────
echo "→ Submit receiveMessage..."
echo "  target=$ARC_MSG_TRANSMITTER  rpc=$ARC_RPC"

# Thêm --legacy nếu Arc Testnet không support EIP-1559
cast send "$ARC_MSG_TRANSMITTER" \
  "receiveMessage(bytes,bytes)" \
  "$MESSAGE" "$ATTESTATION" \
  --rpc-url "$ARC_RPC" \
  --private-key "${PRIVATE_KEY:?set PRIVATE_KEY}"

echo "✓ Relay hoàn tất — hook sẽ fire trên Arc Testnet."
