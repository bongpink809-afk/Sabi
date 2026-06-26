---
name: project-sabi-phase1
description: "Sabi Split Bill dApp — tech stack, network config, Phase 1 completion status, and critical security decisions"
metadata:
  node_type: memory
  type: project
  originSessionId: f5b2600d-b9a1-40df-adeb-803d3e16ffdc
---

Sabi là Split Bill dApp trên Arc Testnet dùng USDC + CCTP V2. Phase 1 (CCTP Hook isolation test): code/test local đã xong, còn 1 việc bắt buộc chưa làm — chạy integration test thật trên Base Sepolia → Arc (offset đã confirm từ source code, KHÔNG còn là mục đích của bước này). Chưa tính là Phase 1 hoàn tất.

**Why:** Portfolio project, dùng thật với nhóm bạn builder trên Arc Testnet. Testnet only — không mainnet.

**Network config (Arc Testnet):**

- Chain ID: 5042002
- USDC: `0x3600000000000000000000000000000000000000`
- CCTP Domain: 26
- CCTP V2 ONLY — V1 deprecated 31/7/2026

**Phase 1 files:**

- `src/interfaces/IHookReceiver.sol` — CCTP V2 hook interface
- `src/BillHookReceiver.sol` — isolated hook receiver (stateless, decode + validate + emit)
  - Có `event DebugMessageBody(bytes messageBody)` — emit raw messageBody để debug nếu cần. TODO: xóa trước Phase 3.
- `test/BillHookReceiver.t.sol` — 5 unit tests (all pass): happy path, WrongSender, WrongAmount, priority order, UnauthorizedCaller
- `spec/split-bill-dapp-spec.md` — full product spec 9 mục, đã commit vào repo
- `memory/project_sabi_phase1.md` — file này
- `MEMORY.md` — index ở gốc repo

**Critical security note baked into code:**

- BurnMessageV2 byte offsets confirmed từ BurnMessageV2.sol (circlefin/evm-cctp-contracts): 68=amount, 100=messageSender, 228=hookData. Layout V2: maxFee(132), feeExecuted(164), expirationBlock(196), hookData(228+). Không còn TODO về offset.
- `returns (bool)` confirmed từ IMessageHandlerV2.sol — đã sửa từ `bytes4` sai trước đó.
- `AlreadyPaid` trong Phase 3 là lớp bảo vệ DUY NHẤT chống double-spend kiểu "2 burn riêng biệt cùng trỏ vào 1 share" — CCTP nonce chỉ chặn replay cùng 1 message. Test case này bắt buộc ở Phase 3, không optional.

**Trạng thái Phase 1 (tính đến cuối session này):**

- Code + 5 unit test: xong, pass hết, gas snapshot đã lưu (happy path ~23,881 gas).
- Còn lại (bắt buộc trước khi Phase 1 tính là xong): chạy integration test thật trên Base Sepolia → Arc — xác nhận hook fire đúng, event emit đúng, flow end-to-end hoạt động ngoài môi trường giả lập. Offset đã confirm; `DebugMessageBody` vẫn dùng để debug nếu cần.

**Coding style (lưu ở local Auto Memory — feedback_coding_style.md, không trong repo):**

- Show toàn bộ diff + giải thích từng thay đổi TRƯỚC khi apply bất kỳ edit nào. Chờ confirm.
- Comment tiếng Việt cho logic nghiệp vụ, tiếng Anh cho thuật ngữ kỹ thuật.
- Custom error only, không dùng string revert message.

**How to apply:** Khi làm Phase 2 (Bill lõi) và Phase 3 (gộp hook + Bill), đọc lại TODO comment trong `handleReceiveFinalizedMessage` trước khi code. Đọc `spec/split-bill-dapp-spec.md` mục 5+6 cho data model và luồng CCTP hook.

**Roadmap còn lại:** Phase 2 (Bill contract, pay trực tiếp trên Arc), Phase 3 (gộp hook + Bill, end-to-end), Phase 4 (frontend Next.js), Phase 5 (multi-chain), Phase 6 (resume pending + whitelist), Phase 7 (test thật với nhóm).
