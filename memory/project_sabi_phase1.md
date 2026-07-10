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

---

## Cập nhật (session sau — frontend payment modal UI)

**QUAN TRỌNG:** File này đã đứng yên từ lúc đóng Phase 1 (30/06), KHÔNG được cập nhật qua Phase 2/3/4. Dựa theo git log (không phải do session này tự làm), các phase sau đã tiến triển xa hơn những gì file này còn ghi:

- `1834f68` — DebugMessageBody đã bị xoá đúng theo TODO của Phase 1 ("xóa trước Phase 3").
- `4ac208a` — "Phase 3 done: payCrossChain, ASSIGNED + OPEN_SLOT cross-chain, 29 test pass".
- `080d14a` — "Phase 4: hoàn thiện luồng cross-chain payment (burn -> attest -> relay), D1/D2 UI".
- Sau đó là hàng loạt commit hoàn thiện frontend (i18n, Firebase sync tên/avatar, mở rộng cross-chain sang Arbitrum + Ethereum Sepolia, retry 429, v.v.) — tức Phase 5 (multi-chain) và một phần Phase 6 (resume pending qua localStorage — xem `useCrossChainPayment.ts`) **đã có code chạy thật**, dù chưa từng được đánh dấu "xong" ở đâu trong repo.

**Không tự gán nhãn "hoàn thành"** cho các phase trên ở đây — session này không làm việc trực tiếp trên Solidity/Foundry nên không tự verify lại được test suite/integration test Base Sepolia → Arc mà Phase 1 note phía trên còn treo. Chỉ ghi lại bằng chứng từ commit message, không suy diễn thêm.

**Việc thực sự làm trong session này (frontend-rk only, không đụng contract):**

Build lại/hoàn thiện 4 modal thanh toán trong `frontend-rk/src/pages/bill/[id].tsx` theo đúng mockup HTML/CSS do chủ dự án cung cấp trực tiếp trong chat (không phải file trong repo):

1. `PaymentChainModal.tsx` — modal chọn chain nguồn trước khi ký `depositForBurn`. Fetch balance USDC song song cả 3 chain (Base/Arbitrum/Ethereum Sepolia). Chỉ cho chọn đúng chain ví đang connect (`currentChainId`) — 2 chain còn lại luôn disable bất kể balance, theo yêu cầu chốt sau khi hỏi lại.
2. `CrossChainProgressModal.tsx` — modal tiến trình CCTP V2: bridge track 3 node (Burn/Attestation/Mint) nối dashed line, "coin" $ chạy dọc theo trạng thái thật của `useCrossChainPayment`, log dạng terminal nền tối với bảng màu riêng (không tái dùng token theme sáng vì tương phản kém trên nền tối).
3. `PaymentSuccessModal.tsx` — modal success dùng chung cho cả 2 luồng (cross-chain + Arc trực tiếp): checkmark SVG animate stroke-draw (bỏ ký tự Unicode "✓" vì render sai hình chevron tuỳ font), confetti tự viết bằng CSS (không thêm dependency).
4. `PaymentArcModal.tsx` — **modal mới**, thay thế text trạng thái rời rạc trước đây (isPaying/payTxHash/paySuccess/payError hiện inline) cho luồng trả trực tiếp trên Arc. Check balance USDC thật qua `useReadContract`, panel "không đủ số dư" kèm 1 link faucet (`https://faucet.circle.com/`), track 2 node (check balance → thanh toán) gọi đúng hàm contract thật (`payShare` cho ASSIGNED, `paySlot` cho OPEN_SLOT — log hiện đúng tên hàm theo mode).

Cộng thêm: `Modal.tsx` (overlay/card dùng chung), `lib/format.ts` (`truncateHash`), thêm namespace `paymentModal` vào `public/locales/{vi,en}/common.json`.

**Bug tìm thấy và fix trong lúc test bằng Playwright (headless, không có ví thật):**

- Log terminal bị lặp đôi do React StrictMode double-invoke effect ở dev — fix bằng ref chặn log theo status đã log rồi.
- next-i18next cache locale JSON phía server — sửa key trong `common.json` không tự hot-reload, phải restart dev server mới thấy.

**Giới hạn đã biết, CHƯA verify được (cần ví thật):**

- Card ở `PaymentChainModal` có thực sự disable đúng 2/3 chain khi wallet đổi mạng hay không.
- Toàn bộ flow ký thật `payShare`/`paySlot` trên Arc qua `PaymentArcModal` (bao gồm panel không đủ số dư, retry sau lỗi).
- Link faucet `https://faucet.circle.com/` có hoạt động đúng cho mục đích lấy USDC test trên Arc hay không.

**Đã commit + push (session này, `main`):**

- `1cd96fb` — Thêm flow thanh toán dạng modal (chọn chain, CCTP progress, success, trả trực tiếp Arc)
- `6d488a9` — Fix: thêm confetti thiếu ở modal Pay Arc + sửa copy EN "Contribute" -> "Pay"
- `bc5acd0` — Update copy: allow_usdc label (chỉnh tay bởi chủ dự án, không phải do session này — nội dung EN hiện ghi "Aprove USDC", có thể là lỗi gõ thiếu chữ "p", đã báo cho chủ dự án, chưa tự sửa vì không được yêu cầu)

**How to apply:** Trước khi động vào `frontend-rk/src/hooks/useCrossChainPayment.ts` hoặc `useBurnCrossChain.ts`, đọc kỹ comment trong đó — nhiều quyết định (gas buffer 50%, timeout 45s cho burn, phân biệt `attestation_delayed` với lỗi thật) đã có lý do cụ thể ghi sẵn, đừng đổi mà không hiểu tại sao.
