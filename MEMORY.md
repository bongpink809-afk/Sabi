# MEMORY.md — Sabi project state

Sabi là Split Bill dApp trên Arc Testnet dùng USDC + CCTP V2 (Fast Transfer). Portfolio project, test thật với nhóm bạn builder trên Arc Testnet — testnet only, không mainnet.

## Trạng thái tổng quan (theo bằng chứng git log, không suy diễn)

- **Phase 1** (CCTP Hook isolation test, Solidity/Foundry): code + 5 unit test xong, pass hết (gas happy-path ~23,881). `DebugMessageBody` debug event đã xoá đúng TODO (`1834f68`). Repo không có bằng chứng đã chạy integration test thật Base Sepolia → Arc — không tự gán "hoàn thành".
- **Phase 3** (gộp hook + Bill contract, end-to-end): commit `4ac208a` ghi "Phase 3 done: payCrossChain, ASSIGNED + OPEN_SLOT cross-chain, 29 test pass".
- **Phase 4** (frontend Next.js): commit `080d14a` ghi "Phase 4: hoàn thiện luồng cross-chain payment (burn -> attest -> relay), D1/D2 UI". Frontend (`frontend-rk/`, Next.js + wagmi/viem + RainbowKit) chạy thật với contract đã deploy trên Arc Testnet.
- **Phase 5 (multi-chain)** và một phần **Phase 6 (resume pending)**: có code chạy thật dù chưa từng được đánh dấu "xong" chính thức — cross-chain hỗ trợ 3 chain nguồn (Base/Arbitrum/Ethereum Sepolia), state cross-chain persist qua `localStorage` nên đóng tab giữa chừng vẫn resume được (`useCrossChainPayment.ts`).
- Chi tiết đầy đủ + phần cập nhật mới nhất: xem `memory/project_sabi_phase1.md` (file trong repo này, KHÔNG phải link ngoài git).

## Network config (Arc Testnet)

| Field       | Value                                          |
| ----------- | ----------------------------------------------- |
| Chain ID    | 5042002                                          |
| USDC        | `0x3600000000000000000000000000000000000000`    |
| CCTP Domain | 26                                               |
| RPC         | `https://rpc.testnet.arc.network`                |
| Explorer    | `https://testnet.arcscan.app`                    |

CCTP V2 ONLY — V1 deprecated 31/7/2026. Fast Transfer (`minFinalityThreshold ≤ 500`).

## Security decisions đã chốt

- **AlreadyPaid (bắt buộc từ Phase 3):** CCTP nonce chỉ chặn replay cùng 1 message, KHÔNG chặn được 2 burn riêng biệt (2 nonce khác nhau) cùng trỏ vào 1 billId/shareId. `AlreadyPaid` là lớp bảo vệ DUY NHẤT chống double-spend kiểu này.
- **No custody:** Đường trực tiếp trên Arc — `transferFrom(msg.sender, organizer, amount)`, không chạm contract. Đường CCTP cross-chain — USDC mint vào contract rồi `transfer` đến organizer atomic trong cùng 1 tx, không giữ qua block.
- **mintRecipient phải là địa chỉ Bill contract** (không phải wallet organizer) để hook fire được.
- BurnMessageV2 byte offsets: 68=amount, 100=messageSender, 228=hookData (confirmed từ source circlefin/evm-cctp-contracts, không còn TODO).

## Frontend — 4 modal thanh toán (mới nhất, `frontend-rk/`)

Build lại theo mockup HTML/CSS chủ dự án cung cấp trực tiếp trong chat (không phải file trong repo):

1. **`PaymentChainModal.tsx`** — chọn chain nguồn trước khi ký `depositForBurn`. Fetch balance USDC song song cả 3 chain. Chỉ cho chọn đúng chain ví đang connect (`currentChainId`) — 2 chain còn lại luôn disable bất kể balance.
2. **`CrossChainProgressModal.tsx`** — tiến trình CCTP V2: bridge track 3 node (Burn/Attestation/Mint) + "coin" $ chạy dọc theo trạng thái thật của `useCrossChainPayment`, log terminal nền tối (bảng màu riêng cho nền tối, không tái dùng token theme sáng).
3. **`PaymentSuccessModal.tsx`** — success dùng chung cho cả 2 luồng, checkmark SVG stroke-draw animation (bỏ ký tự Unicode "✓" vì render sai hình tuỳ font), confetti tự viết CSS (không thêm dependency).
4. **`PaymentArcModal.tsx`** — modal mới cho luồng trả trực tiếp trên Arc, thay text trạng thái rời rạc cũ. Check balance thật qua `useReadContract`, panel "không đủ số dư" + 1 link faucet, track 2 node gọi đúng hàm contract thật (`payShare`/`paySlot` theo mode).

Kèm `Modal.tsx` (overlay/card dùng chung), `lib/format.ts` (`truncateHash`), namespace `paymentModal` trong `public/locales/{vi,en}/common.json`.

**Bug đã fix trong lúc build:** log terminal lặp đôi do React StrictMode double-invoke (fix bằng ref chặn log theo status); next-i18next cache locale JSON phía server (sửa key trong `common.json` phải restart dev server mới thấy, không tự hot-reload).

**Chưa verify được (cần ví thật):** disable đúng 2/3 chain khi đổi mạng ví ở `PaymentChainModal`; toàn bộ flow ký thật `payShare`/`paySlot` qua `PaymentArcModal`; link faucet `https://faucet.circle.com/` có hoạt động đúng mục đích không.

**Commit gần nhất trên `main`:** `bc5acd0` (Update copy: allow_usdc label) ← `6d488a9` (fix confetti Arc modal + copy EN) ← `1cd96fb` (thêm 4 modal thanh toán). Lưu ý bản EN của `allow_usdc` hiện ghi "Aprove USDC" (thiếu chữ "p"), do chủ dự án tự sửa tay, đã báo nhưng chưa tự fix vì không được yêu cầu.

## Coding style (áp dụng mọi file trong repo này)

- **Show diff trước khi apply:** trước mọi edit Solidity, in toàn bộ diff dự kiến + giải thích từng dòng, chờ confirm trước khi apply.
- **Comment:** tiếng Việt cho logic nghiệp vụ, tiếng Anh cho thuật ngữ kỹ thuật (event, function, struct field, CCTP terms).
- **Error:** custom error only (`error WrongAmount(...)`), không dùng string revert message.
- **Scope:** không thêm tính năng ngoài spec đã chốt (`spec/split-bill-dapp-spec.md`) hoặc ngoài yêu cầu trực tiếp trong chat — thấy thiếu thì hỏi, không tự suy diễn.

## Roadmap 7 phase (gốc)

1. CCTP Hook riêng — code/test local xong, integration test thật chưa xác nhận trong repo.
2. Bill contract lõi (pay trực tiếp trên Arc, cả 2 mode).
3. Gộp Phase 1+2 — "Phase 3 done" theo commit `4ac208a`.
4. Frontend MVP — "hoàn thiện" theo commit `080d14a`, tiếp tục phát triển UI sau đó (kể cả session mới nhất).
5. Mở rộng đa chain + balance check + QR/WalletConnect — đa chain (3 chain nguồn) đã chạy, chưa rõ QR/WalletConnect.
6. Resume pending + circuit breaker message + whitelist + faucet helper — resume pending qua localStorage đã chạy; whitelist/circuit breaker chưa rõ.
7. Test thật với nhóm bạn builder trên Arc Testnet — chưa có bằng chứng trong repo.

## Spec đầy đủ

Xem `spec/split-bill-dapp-spec.md` — 9 mục: tổng quan, 2 mode bill, luồng sử dụng, QR, data model, CCTP hook, network config, rủi ro, roadmap.
