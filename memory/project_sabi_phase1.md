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
  - Có `event DebugMessageBody(bytes messageBody)` — emit trước khi decode, dùng để so offset với burn thật. TODO: xóa trước Phase 3.
- `test/BillHookReceiver.t.sol` — 5 unit tests (all pass): happy path, WrongSender, WrongAmount, priority order, UnauthorizedCaller
- `spec/split-bill-dapp-spec.md` — full product spec 9 mục, đã commit vào repo
- `memory/project_sabi_phase1.md` — file này
- `MEMORY.md` — index ở gốc repo

**Trạng thái Phase 1 (tính đến cuối session này):**
- Code + 5 unit test: xong, pass hết, gas snapshot đã lưu.
- Còn lại (bắt buộc trước khi Phase 1 tính là xong): verify BurnMessageV2 byte offsets bằng burn thật từ Base Sepolia — lấy messageBody thực, so offset 68/100/168 với trường thực tế qua `DebugMessageBody` event log.

**Critical security note baked into code:**
- BurnMessageV2 byte offsets (68=amount, 100=messageSender, 168=hookData) lấy từ Circle whitepaper, CHƯA verify với dữ liệu thật từ Base Sepolia — đây là việc còn lại của Phase 1. OFFSET_HOOK_DATA có thể là 172 thay vì 168 nếu Circle chèn hookDataOffset prefix.
- `AlreadyPaid` trong Phase 3 là lớp bảo vệ DUY NHẤT chống double-spend kiểu "2 burn riêng biệt cùng trỏ vào 1 share" — CCTP nonce chỉ chặn replay cùng 1 message. Test case này bắt buộc ở Phase 3, không optional.
- `returns (bytes4)` trong handleReceiveFinalizedMessage — đã đổi từ `bool` ban đầu, CHƯA xác nhận đúng với interface CCTP V2 thật. Cần verify khi deploy thật lên Arc Testnet (xem ABI/test thực tế khi gọi qua MessageTransmitterV2), trước khi tích hợp vào Bill contract ở Phase 3.

**Coding style (lưu ở local Auto Memory — feedback_coding_style.md, không trong repo):**
- Show toàn bộ diff + giải thích từng thay đổi TRƯỚC khi apply bất kỳ edit nào. Chờ confirm.
- Comment tiếng Việt cho logic nghiệp vụ, tiếng Anh cho thuật ngữ kỹ thuật.
- Custom error only, không dùng string revert message.

**How to apply:** Khi làm Phase 2 (Bill lõi) và Phase 3 (gộp hook + Bill), đọc lại TODO comment trong `handleReceiveFinalizedMessage` trước khi code. Đọc `spec/split-bill-dapp-spec.md` mục 5+6 cho data model và luồng CCTP hook.

**Roadmap còn lại:** Phase 2 (Bill contract, pay trực tiếp trên Arc), Phase 3 (gộp hook + Bill, end-to-end), Phase 4 (frontend Next.js), Phase 5 (multi-chain), Phase 6 (resume pending + whitelist), Phase 7 (test thật với nhóm).
