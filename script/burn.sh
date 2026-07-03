#!/usr/bin/env bash
# burn.sh — Burn USDC trên Base Sepolia → Arc Testnet qua CCTP V2
#
# Usage:
#   PRIVATE_KEY=0x... ./script/burn.sh
#
# Env vars bắt buộc (thêm vào .env):
#   PRIVATE_KEY           — khóa bí mật người dùng
#   BASE_TOKEN_MESSENGER  — TokenMessengerV2 trên Base Sepolia
#   HOOK_RECEIVER         — địa chỉ BillHookReceiver đã deploy trên Arc Testnet
#
# Env vars tùy chọn:
#   BASE_SEPOLIA_RPC      — mặc định: https://sepolia.base.org
#   AMOUNT                — mặc định: 1000000 (= 1 USDC, 6 decimals)
#   HOOK_DATA             — mặc định: 0x (empty, đủ cho Phase 1 test)
#   MAX_FEE               — mặc định: 0 (self-relay)
#   MIN_FINALITY          — mặc định: 500; dùng 2000 cho standard finality
#
# Yêu cầu: cast (Foundry), jq

set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────────
BASE_RPC="${BASE_SEPOLIA_RPC:-https://sepolia.base.org}"
BASE_USDC="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
BASE_TOKEN_MESSENGER="${BASE_TOKEN_MESSENGER:?set BASE_TOKEN_MESSENGER}"
HOOK_RECEIVER="${HOOK_RECEIVER:?set HOOK_RECEIVER}"

ARC_DOMAIN=26
AMOUNT="${AMOUNT:-1000000}"
HOOK_DATA="${HOOK_DATA:-0x00}"
MAX_FEE="${MAX_FEE:-0}"
MIN_FINALITY="${MIN_FINALITY:-500}"

# ── Chuyển HOOK_RECEIVER address → bytes32 (left-pad với 0) ───────────────
RECEIVER_HEX="${HOOK_RECEIVER#0x}"
MINT_RECIPIENT="0x$(printf '%064s' "$RECEIVER_HEX" | tr ' ' '0')"

# destinationCaller = bytes32(0): bất kỳ ai cũng có thể relay
DESTINATION_CALLER="0x0000000000000000000000000000000000000000000000000000000000000000"

CALLER_WALLET=$(cast wallet address --private-key "${PRIVATE_KEY:?set PRIVATE_KEY}")

echo "── Burn config ──────────────────────────────────────────────────────────"
echo "  wallet:              $CALLER_WALLET"
echo "  amount:              $AMOUNT (USDC 6 decimals)"
echo "  mintRecipient:       $MINT_RECIPIENT"
echo "  destinationDomain:   $ARC_DOMAIN (Arc Testnet)"
echo "  maxFee:              $MAX_FEE"
echo "  minFinality:         $MIN_FINALITY"
echo "  hookData:            $HOOK_DATA"
echo "────────────────────────────────────────────────────────────────────────"

# ── Step 1: Approve TokenMessengerV2 dùng USDC ─────────────────────────────
echo ""
echo "→ Approve $AMOUNT USDC cho TokenMessengerV2 ($BASE_TOKEN_MESSENGER)..."

cast send "$BASE_USDC" \
  "approve(address,uint256)" \
  "$BASE_TOKEN_MESSENGER" "$AMOUNT" \
  --rpc-url "$BASE_RPC" \
  --private-key "$PRIVATE_KEY"

echo "✓ Approved."

# ── Step 2: depositForBurnWithHook ─────────────────────────────────────────
echo ""
echo "→ depositForBurnWithHook..."

TX_HASH=$(cast send "$BASE_TOKEN_MESSENGER" \
  "depositForBurnWithHook(uint256,uint32,bytes32,address,bytes32,uint256,uint32,bytes)" \
  "$AMOUNT" \
  "$ARC_DOMAIN" \
  "$MINT_RECIPIENT" \
  "$BASE_USDC" \
  "$DESTINATION_CALLER" \
  "$MAX_FEE" \
  "$MIN_FINALITY" \
  "$HOOK_DATA" \
  --rpc-url "$BASE_RPC" \
  --private-key "$PRIVATE_KEY" \
  --json | jq -r '.transactionHash')

echo ""
echo "✓ Burn thành công!"
echo ""
echo "  TX_HASH=$TX_HASH"
echo ""
echo "Bước tiếp theo — relay sang Arc Testnet:"
echo "  bash script/relay.sh $TX_HASH"