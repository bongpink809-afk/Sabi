# MEMORY.md — Sabi project state

Sabi là Split Bill dApp trên Arc Testnet dùng USDC + CCTP V2 (Fast Transfer). Portfolio project, test thật với nhóm bạn builder trên Arc Testnet — testnet only, không mainnet.

## Trạng thái tổng quan (theo bằng chứng git log, không suy diễn)

- **Phase 1** (CCTP Hook isolation test, Solidity/Foundry): code + 5 unit test xong, pass hết (gas happy-path ~23,881). `DebugMessageBody` debug event đã xoá đúng TODO (`1834f68`). Repo không có bằng chứng đã chạy integration test thật Base Sepolia → Arc — không tự gán "hoàn thành".
- **Phase 3** (gộp hook + Bill contract, end-to-end): commit `4ac208a` ghi "Phase 3 done: payCrossChain, ASSIGNED + OPEN_SLOT cross-chain, 29 test pass".
- **Phase 4** (frontend Next.js): commit `080d14a` ghi "Phase 4: hoàn thiện luồng cross-chain payment (burn -> attest -> relay), D1/D2 UI". Frontend (`frontend-rk/`, Next.js + wagmi/viem + RainbowKit) chạy thật với contract đã deploy trên Arc Testnet.
- **Phase 5 (multi-chain)** và một phần **Phase 6 (resume pending)**: có code chạy thật dù chưa từng được đánh dấu "xong" chính thức — cross-chain hỗ trợ 3 chain nguồn (Base/Arbitrum/Ethereum Sepolia), state cross-chain persist qua `localStorage` nên đóng tab giữa chừng vẫn resume được (`useCrossChainPayment.ts`).
- Chi tiết đầy đủ + phần cập nhật mới nhất: xem `memory/project_sabi_phase1.md` (file trong repo này, KHÔNG phải link ngoài git).

## Cập nhật mới nhất (session Circle email login + fix bug retry mạng)

**Đã làm (frontend-rk only, không đụng contract):**

- **Tính năng "Sign in with email" (Circle User-Controlled Wallets) — xây xong, đang TẠM DỪNG qua feature flag** (commit `8b2cde4`): 5 API route `pages/api/circle/*`, `contexts/CircleWalletContext.tsx`, `components/CircleLoginModal.tsx`, nút trigger trong `SabiHeader.tsx`, nhánh `isCircleActive` trong `bill/[id].tsx` + `PaymentArcModal.tsx`, mapping `emailWallets` trong `lib/firebase.ts`. Chỉ hỗ trợ trả trực tiếp trên Arc (approve/payShare/paySlot) — KHÔNG cross-chain, vì đã verify (raw `.d.ts` + raw OpenAPI JSON của Circle) rằng SDK Circle không expose EIP-1193 provider nên không dùng chung được với wagmi's `useWriteContract`; phải qua model challenge+execute riêng của Circle.
  - Bug thật tìm được lúc test (không phải bug code): gọi thẳng API Circle thấy lỗi `{"code":155159,"message":"Failed to auth to the SMTP server..."}` — lỗi cấu hình SMTP Mailtrap Sandbox trong Circle Console, không phải lỗi repo.
  - Chủ dự án quyết định **tạm dừng**: comment `NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN=true` trong `.env.local` (gitignore, không có trong git) — không xoá code. Verify: nút biến mất (SSR HTML), build sạch, `isCircleActive` luôn `false` khi tắt (xác nhận bằng đọc code, không đoán).
  - Việc còn treo lại NẾU bật lại sau này: xác nhận field tx hash thật trong `transaction-status.ts` (cần chạy 1 challenge `contractExecution` thật, log response).
- **Fix bug retry mạng, liên quan trực tiếp bug bill 36** (commit `0ead92b`): user báo lỗi `HTTP request failed... Details: Failed to fetch` khi quét `eth_getLogs`. Verify bằng `curl` gọi lại đúng request → RPC trả 200 OK bình thường (không phải RPC down). Đọc source `viem/utils/rpc/http.ts` xác nhận: khi `fetch()` tự throw (mất mạng thoáng qua), viem bọc thành `HttpRequestError` nhưng KHÔNG có `status` — `withRetry429()` (`eventScan.ts`) và `isRateLimited()` (`rpcRetry.ts`) trước đó chỉ retry `status === 429` nên loại lỗi này rớt thẳng, không thử lại. Đã sửa cả 2 file retry thêm `status === undefined`. **Nhiều khả năng đây mới là nguyên nhân thật của bug bill 36** (Profile không hiện bill vừa trả) — thay thế giả thuyết "MAX_CHUNKS cache cap" chưa verify trực tiếp ở update trước. Chủ dự án xác nhận coi bill 36 là đã fix qua hướng này.
- Giả thuyết `MAX_CHUNKS` cache cap trong `eventScan.ts` (xem mục dưới) vẫn còn tồn tại lý thuyết, chưa fix — ưu tiên thấp sau khi bug retry mạng đã sửa.
- Trạng thái push: commit `8b2cde4` và `0ead92b` — kiểm tra `git log origin/main..HEAD` để biết chắc đã push chưa lúc đọc lại.

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session đổi route landing/create + điều tra bug Profile/Bill detail)

**Đã làm (frontend-rk only, không đụng contract):**

- **Đổi route:** `/` giờ là landing page (trước đó ở `/landing`), `/create` là trang tạo bill (trước đó ở `/`) — theo yêu cầu chốt, deadline 9/8. Dùng `git mv` giữ history: `pages/landing.tsx` → `pages/index.tsx`, `pages/index.tsx` (cũ) → `pages/create.tsx`. Sửa mọi `href="/"`/`pathname === '/'` mang ý nghĩa "vào trang tạo bill" sang `/create`: logo + tab "Tạo bill" + check `isHome` trong `SabiHeader.tsx`, CTA "Create a bill" ở landing. Link share bill (`window.location.origin` + `/bill/[id]`) và `next.config.js` không phụ thuộc `/` nên không cần sửa.
- Verify: `npm run build` pass, route table đúng. Môi trường không có `chromium-cli`/Playwright (không tự cài vì cần tải browser binary) → verify bằng dev server thật + `curl` đọc SSR HTML thay vì browser thật. **Chưa test tay bằng browser** (connect ví MetaMask ở `/create`, đổi VI/EN) — cần chủ dự án tự kiểm tra.
- Landing page không có i18n (hardcode tiếng Anh từ trước, không phải do session này) — đổi VI/EN sẽ không có tác dụng ở `/`, đã báo cho chủ dự án.

**Điều tra bug user báo ở bill 36 (CHỈ điều tra bằng `cast`/Firestore REST thật, CHƯA sửa code):**

- Cả 2 share đã trả của bill 36 (share 7 "Bông", share 8 "Linh Gấu") đều `paid=true` on-chain — tiền không mất.
- "Chi tiết bill chỉ hiện 'Linh Gấu' không hiện '(Jack trả)'": **không phải bug**. Ví đã trả share đó tự đặt `profileName Firestore = "Linh Gấu"` — trùng tên share nên `combinePaidName()` cố tình ẩn "(X trả)" (tránh lặp "Linh Gấu (Linh Gấu trả)", đúng thiết kế). Không tồn tại hồ sơ Firestore nào tên "Jack" — muốn hiện "(Jack trả)" thì ví đó phải tự đổi tên ở `/profile`.
- "`/profile` không hiện bill 36 trong danh sách đã trả": **chưa xác nhận chắc nguyên nhân**, nghi ngờ có căn cứ là cache quét log (`eventScan.ts`, key `sabi-scan-SharePaid` dùng chung mọi ví) giới hạn cứng 40.000 block/lần tải TRANG kể cả khi đang bắt kịp (catch-up) từ cache cũ, không riêng lần quét nguội đầu — nếu cache tụt hậu hơn 40k block phải tải lại `/profile` thêm 1-2 lần mới thấy giao dịch mới. Đã đề nghị chủ dự án reload thử để xác nhận trước khi sửa `eventScan.ts`, chưa tự sửa vì chưa xác nhận.
- Ghi nhận riêng, không phải bug: `NEXT_PUBLIC_SABI_BILL_ADDRESS` trong `.env.local` là biến chết (không được code nào đọc) — contract thật dùng hardcode trong `lib/contracts.ts`. Chưa xoá vì không được yêu cầu.

Chi tiết đầy đủ (bao gồm địa chỉ ví, block number, tx hash cụ thể đã tra): xem `memory/project_sabi_phase1.md`.

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
