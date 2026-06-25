---
name: project-sabi-phase1
description: "Sabi Split Bill dApp — tech stack, network config, Phase 1 completion status, and critical security decisions"
metadata: 
  node_type: memory
  type: project
  originSessionId: f5b2600d-b9a1-40df-adeb-803d3e16ffdc
---

Sabi là Split Bill dApp trên Arc Testnet dùng USDC + CCTP V2. Phase 1 (CCTP Hook isolation test): code/test local đã xong, còn 1 việc bắt buộc chưa làm — verify offset bằng burn thật từ Base Sepolia. Chưa tính là Phase 1 hoàn tất.

**Why:** Portfolio project, dùng thật với nhóm bạn builder trên Arc Testnet. Testnet only — không mainnet.

**Network config (Arc Testnet):**
- Chain ID: 5042002
- USDC: `0x3600000000000000000000000000000000000000`
- CCTP Domain: 26
- CCTP V2 ONLY — V1 deprecated 31/7/2026

**Phase 1 files:**
- `src/interfaces/IHookReceiver.sol` — CCTP V2 hook interface
- `src/BillHookReceiver.sol` — isolated hook receiver (stateless, decode + validate + emit)
- `test/BillHookReceiver.t.sol` — 5 unit tests (all pass)

**Critical security note baked into code:**
- BurnMessageV2 byte offsets (68=amount, 100=messageSender, 168=hookData) lấy từ Circle whitepaper, CHƯA verify với dữ liệu thật từ Base Sepolia — đây là việc còn lại của Phase 1.
- `AlreadyPaid` trong Phase 3 là lớp bảo vệ DUY NHẤT chống double-spend kiểu "2 burn riêng biệt cùng trỏ vào 1 share" — CCTP nonce chỉ chặn replay cùng 1 message. Test case này bắt buộc ở Phase 3.
- `returns (bytes4)` trong handleReceiveFinalizedMessage — đã đổi từ `bool` ban đầu, CHƯA xác nhận đúng với interface CCTP V2 thật. Cần verify khi deploy thật lên Arc Testnet (xem ABI/test thực tế khi gọi qua MessageTransmitterV2), trước khi tích hợp vào Bill contract ở Phase 3.

**How to apply:** Khi làm Phase 2 (Bill lõi) và Phase 3 (gộp hook + Bill), đọc lại TODO comment trong `handleReceiveFinalizedMessage` trước khi code.

**Roadmap còn lại:** Phase 2 (Bill contract, pay trực tiếp trên Arc), Phase 3 (gộp hook + Bill, end-to-end), Phase 4 (frontend Next.js), Phase 5 (multi-chain), Phase 6 (resume pending + whitelist), Phase 7 (test thật với nhóm).
