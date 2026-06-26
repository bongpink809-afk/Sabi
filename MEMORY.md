# MEMORY.md — Sabi project state

## Phase 1: CCTP Hook isolation test
**Trạng thái:** Code + 5 unit test xong, pass hết. **Chưa hoàn tất** — còn 1 việc bắt buộc: verify BurnMessageV2 byte offsets bằng burn thật từ Base Sepolia (dùng `DebugMessageBody` event log để so offset 68/100/168 với dữ liệu thực tế).

**Files Phase 1:**
- `src/interfaces/IHookReceiver.sol` — CCTP V2 hook interface (`handleReceiveFinalizedMessage` trả `bytes4`)
- `src/BillHookReceiver.sol` — isolated hook receiver, stateless, có `DebugMessageBody` event (TODO: xóa trước Phase 3)
- `test/BillHookReceiver.t.sol` — 5 tests: happy path, WrongSender, WrongAmount, priority order, UnauthorizedCaller

**TODO còn lại của Phase 1 (bắt buộc):**
1. Burn thật từ Base Sepolia → xác nhận offset bằng dữ liệu on-chain thực tế qua `DebugMessageBody` event log

**Đã giải quyết (không còn TODO):**
- Offset confirmed từ BurnMessageV2.sol chính thức: 68=amount, 100=messageSender, 228=hookData. Layout V2: maxFee(132), feeExecuted(164), expirationBlock(196), hookData(228+).
- Return type confirmed từ IMessageHandlerV2.sol: `returns (bool)` — đã sửa từ `bytes4` sai.

## Security decisions đã chốt

- **AlreadyPaid (Phase 3 — bắt buộc):** CCTP nonce chỉ chặn replay cùng 1 message. Không chặn được 2 burn riêng biệt (2 nonce khác nhau) cùng trỏ vào 1 billId/shareId. `AlreadyPaid` là lớp bảo vệ DUY NHẤT — test case "lần 2 revert AlreadyPaid" bắt buộc ở Phase 3.
- **No custody:** Đường trực tiếp trên Arc: `transferFrom(msg.sender, organizer, amount)` — không chạm contract. Đường CCTP cross-chain: USDC mint vào contract rồi `transfer` đến organizer atomic trong cùng 1 tx — không giữ qua block.
- **mintRecipient phải là địa chỉ Bill contract** (không phải wallet organizer) để hook fire được.

## Network config (Arc Testnet)

| Field | Value |
|---|---|
| Chain ID | 5042002 |
| USDC | `0x3600000000000000000000000000000000000000` |
| CCTP Domain | 26 |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | `https://testnet.arcscan.app` |

CCTP V2 ONLY — V1 deprecated 31/7/2026. Fast Transfer (`minFinalityThreshold ≤ 500`).

## Coding style (áp dụng mọi file trong repo này)

- **Show diff trước khi apply:** Trước mọi edit Solidity, in toàn bộ diff dự kiến + giải thích từng dòng. Chờ confirm trước khi apply.
- **Comment:** Tiếng Việt cho logic nghiệp vụ, tiếng Anh cho thuật ngữ kỹ thuật (event, function, struct field, CCTP terms).
- **Error:** Custom error only (`error WrongAmount(...)`), không dùng string revert message.
- **Scope:** Không thêm tính năng ngoài spec đã chốt (`spec/split-bill-dapp-spec.md`). Thấy thiếu thì hỏi, không tự suy diễn.

## Roadmap 7 Phase

1. **CCTP Hook riêng** ← đang ở đây (code xong, offset chưa verify)
2. **Bill contract lõi** — pay trực tiếp trên Arc, cả 2 mode (ASSIGNED + OPEN_SLOT)
3. **Gộp Phase 1+2** — end-to-end 2 đường trả, 1 bill thật
4. **Frontend MVP** — Next.js 14, wagmi/viem, RainbowKit, 2 chain
5. **Mở rộng đa chain** + balance check + QR/WalletConnect
6. **Resume pending** + circuit breaker message + whitelist + faucet helper
7. **Test thật với nhóm bạn builder** trên Arc Testnet

## Spec đầy đủ

Xem `spec/split-bill-dapp-spec.md` — 9 mục: tổng quan, 2 mode bill, luồng sử dụng, QR, data model, CCTP hook, network config, rủi ro, roadmap.
