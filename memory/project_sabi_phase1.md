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

---

## Cập nhật (session sau — đổi route landing/create, điều tra bug hiển thị Profile/Bill detail)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ đụng `frontend-rk/`, không chạy lại test Solidity/Foundry, không có bằng chứng mới về integration test Base Sepolia → Arc mà Phase 1 còn treo.

**Việc đã làm xong (đã commit hay chưa commit — xem log lúc đọc lại file này để biết chắc):**

1. **Đổi route landing/create:** trước đó landing nằm ở `/landing`, `/` là trang tạo bill. Theo yêu cầu chốt mới (deadline 9/8), đảo lại: `/` = landing (`pages/index.tsx`, nội dung y hệt `pages/landing.tsx` cũ, dùng `git mv` giữ history), `/create` = trang tạo bill (`pages/create.tsx`, nội dung y hệt `pages/index.tsx` cũ). Đã sửa mọi chỗ trỏ cứng `href="/"`/`pathname === '/'` với ý nghĩa "vào trang tạo bill" sang `/create` — cụ thể: logo link, tab "Tạo bill", check `isHome` trong `SabiHeader.tsx`, và CTA "Create a bill" trong landing.
   - Link chia sẻ bill (`/bill/[id]`, dùng `window.location.origin`) và `next.config.js` không phụ thuộc route `/` — không cần sửa gì.
   - Landing page KHÔNG có i18n (`useTranslation`/`getServerSideProps`) — hardcode tiếng Anh từ trước, không phải do session này gây ra, nên đổi ngôn ngữ VI/EN sẽ không có tác dụng gì ở `/`. Đã báo cho chủ dự án.
   - Verify: `npm run build` pass, route table đúng (`/`, `/create`, `/bill`, `/bill/[id]`, `/profile`). Không có `chromium-cli`/Playwright trong môi trường này (không tự cài vì cần tải browser binary) — verify thay bằng dev server thật + `curl` đọc SSR HTML, xác nhận đúng nội dung/href ở cả 2 route. **Chưa test bằng browser thật/tương tác tay** — phần connect ví MetaMask thật ở `/create` chủ dự án cần tự kiểm tra.

2. **Điều tra bug user báo (bill 36) — CHỈ ĐIỀU TRA, CHƯA SỬA CODE:**
   - Triệu chứng 1: "Đã trả" ở `/profile` không hiện bill 36 dù đã trả thật.
   - Triệu chứng 2: ở chi tiết bill, share "Linh Gấu" chỉ hiện "Linh Gấu", không hiện "(Jack trả)".
   - Verify bằng `cast call`/`cast logs` thẳng trên Arc Testnet RPC (không đoán): `getShare(36,7)` và `getShare(36,8)` đều `paid=true` — tiền đã ghi nhận đúng on-chain, không mất. Payer share 8 ("Linh Gấu") = `0x262e6a7C7b53B968075831FFd03858361296D280`, gọi trực tiếp `payShare` (không phải cross-chain).
   - Verify Firestore REST (`sabi1-f8fe0`, project ID + API key lấy từ `.env.local`, đều là biến `NEXT_PUBLIC_*` nên vốn đã public trong bundle client, không phải rò rỉ secret): ví đó tự đặt `profileName = "Linh Gấu"` (Firestore `users/{addr}`, update lúc 2026-07-28 06:16:44 UTC) — **trùng tên với share được gán sẵn**. `combinePaidName()` trong `bill/[id].tsx` cố tình ẩn "(X trả)" khi 2 tên trùng (tránh "Linh Gấu (Linh Gấu trả)") — **đây KHÔNG phải bug, đúng thiết kế**. Query Firestore toàn collection `users` tìm `profileName == "Jack"` → không có kết quả — không tồn tại hồ sơ nào tên "Jack". Muốn hiện "(Jack trả)", ví đó phải tự đổi tên hồ sơ ở `/profile`.
   - Triệu chứng 1 (Profile không hiện bill 36): **chưa xác nhận chắc chắn nguyên nhân**, nhưng có nghi ngờ có căn cứ — `eventScan.ts` cache log theo `localStorage` (key `sabi-scan-SharePaid`, dùng CHUNG mọi ví), giới hạn cứng `MAX_CHUNKS=8 × CHUNK_SIZE=5000 = 40.000 block` mỗi lần tải trang **kể cả khi đang "bắt kịp" (catch-up) từ cache cũ, không chỉ lần quét nguội đầu tiên**. Nếu cache đã tụt hậu hơn 40k block so với block mới nhất, phải tải `/profile` thêm 1-2 lần mới quét tới block chứa giao dịch mới trả (block của share 8 chỉ cách block mới nhất lúc kiểm tra ~805 block — nên đáng lẽ 1 lần tải là đủ NẾU cache đã cập nhật gần đây). Đã đề nghị chủ dự án reload `/profile` vài lần để xác nhận trước khi sửa code — **CHƯA làm gì với `eventScan.ts` vì chưa có xác nhận, tránh sửa mù**.

**Việc còn pending / TODO chưa chốt:**

- Chờ chủ dự án xác nhận: reload `/profile` có làm bill 36 hiện ra không → nếu có, sửa `eventScan.ts` (bỏ giới hạn `MAX_CHUNKS` cứng cho nhánh catch-up khi ĐÃ có cache, chỉ giữ giới hạn đó cho lần quét nguội đầu tiên — tránh quá tải RPC public). Nếu vẫn không hiện sau reload, cần điều tra thêm hướng khác (vd sai ví đang connect).
- Test tay bằng browser thật cho checklist đổi route (đặc biệt connect ví ở `/create`, đổi VI/EN) — chưa làm được trong session này vì môi trường không có Playwright/chromium-cli.
- Ghi nhận riêng (không phải bug, không cần sửa): `NEXT_PUBLIC_SABI_BILL_ADDRESS` trong `frontend-rk/.env.local` (`0xFbb7765FC0150C5D41bF85EedEb4a45747884Ce5`) khác với `SABI_BILL_ADDRESS` hardcode trong `lib/contracts.ts` (`0x192963eBcC9f39C0057597CF3AA7d97c99a83c75`, contract đang thật sự dùng) — biến env đó chết/không được đọc ở đâu cả, là rác còn sót lại từ lần deploy trước. Chưa xoá vì không được yêu cầu, chỉ ghi nhận.

**How to apply:** Trước khi sửa `eventScan.ts`, đọc kỹ comment trong `logCache.ts` — thiết kế "lần đầu chỉ quét window gần nhất, sau đó tích luỹ dần" là CHỦ Ý (tránh quá tải RPC public khi quét full ~3.75 triệu block lịch sử kể từ lúc deploy), không phải sơ suất — chỉ nới giới hạn cho nhánh "đã có cache, đang bắt kịp", không đổi nhánh "quét nguội lần đầu".

---

## Cập nhật (session sau — thử build tính năng Circle email login, tạm dừng; fix bug retry mạng liên quan bill #36)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ đụng `frontend-rk/`, không chạy lại test Solidity/Foundry.

**1. Tính năng "Sign in with email" (Circle User-Controlled Wallets) — ĐÃ XÂY XONG, đang TẠM DỪNG qua feature flag:**

- Handoff ban đầu giả định sai: "gán địa chỉ ví Circle vào chỗ đang lưu địa chỉ hiện tại là `payCrossChain` dùng được luôn". Đã verify bằng raw source `.d.ts` thật của `@circle-fin/w3s-pw-web-sdk` + raw OpenAPI JSON của Circle (không đoán từ tóm tắt AI — agent nghiên cứu ban đầu bắt được AI-summarizer bịa nội dung 2 lần): **Circle SDK không expose EIP-1193 provider**, wagmi's `useWriteContract` không dùng được trực tiếp. Circle dùng model riêng: backend tạo "challenge" qua REST (`POST /v1/w3s/user/transactions/contractExecution`), frontend gọi `sdk.execute(challengeId)` để user xác nhận PIN.
- Đã chốt scope v1 với chủ dự án: ví Circle **chỉ trả trực tiếp trên Arc** (approve/payShare/paySlot), KHÔNG hỗ trợ cross-chain (payCrossChain) — vẫn cần MetaMask cho cross-chain.
- Đã xây xong (commit `8b2cde4`): 5 API route `pages/api/circle/*` (login-init, wallets, wallets/initialize, contract-execution, transaction-status), `contexts/CircleWalletContext.tsx` (`useCircleWallet` đăng nhập email + `useCircleContractCall` gọi contract qua Circle, chạy song song wagmi không đụng `wagmi.ts`), `components/CircleLoginModal.tsx`, nút trigger trong `SabiHeader.tsx`, nhánh `isCircleActive` trong `bill/[id].tsx` + `PaymentArcModal.tsx` (thêm prop `payerAddress`, nới điều kiện màn "done"), mapping `emailWallets` trong `lib/firebase.ts`, i18n namespace `circle.*`.
- Toàn bộ ẩn/hiện qua 1 feature flag `NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN` (đọc trong `SabiHeader.tsx`) — tắt flag thì `isCircleActive` không bao giờ `true` được (chỉ đổi qua `startEmailLogin()`, hàm này chỉ gọi được từ UI đã bị ẩn), nên toàn bộ luồng wagmi/MetaMask không đổi hành vi khi tắt.
- **Bug thật tìm được lúc test (không phải bug code):** Circle Console báo lỗi khi gửi OTP — verify bằng cách gọi thẳng API Circle (không qua route của mình): `{"code":155159,"message":"Failed to auth to the SMTP server. Please check SMTP setting."}` — lỗi cấu hình SMTP (Mailtrap Sandbox) trong Circle Console → Configurator → Authentication Methods → Email, không phải lỗi trong repo.
- **Chủ dự án quyết định TẠM DỪNG** (không tiếp tục làm nốt phần verify tx-hash field, không chuyển SMTP sang production; không xoá code, không cần đụng Circle Console/Mailtrap). Đã comment `NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN=true` thành `# NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN=true` trong `.env.local` (file này gitignore, không có trong git). Verify lại: nút biến mất khỏi header (SSR HTML), `npm run build` sạch, `isCircleActive` luôn `false` bằng đọc code trực tiếp.
- Toàn bộ tính năng gộp thành **1 commit duy nhất** `8b2cde4` (vì trước đó chưa từng commit lúc "bật" — không có state "on" nào trong git để tách riêng commit "tắt", và bản thân flag nằm trong `.env.local` nên không hiện trong git history được).
- **Việc còn treo lại DUY NHẤT nếu bật lại sau này:** xác nhận field tx hash thật trong `pages/api/circle/transaction-status.ts` — cần chạy 1 challenge `contractExecution` thật với sandbox Circle, log raw response, xem field `state`/`txHash` tên gì rồi mới chốt mapping (hiện đang đoán field name, đã ghi rõ TODO trong code).
- Chưa test tay được flow thật (gửi OTP sau khi sửa SMTP, tạo ví, trả bill qua Circle) — môi trường không có Playwright/ví thật, và SMTP đang lỗi nên chưa gửi OTP thật được dù muốn test.

**2. Fix bug retry mạng — liên quan trực tiếp tới bug bill 36 đã note ở update trước (commit `0ead92b`):**

- User báo lỗi thật: `HTTP request failed... Details: Failed to fetch... viem@2.38.0` khi quét `eth_getLogs` (SlotFilled, billId=31).
- Verify (không đoán): gọi lại ĐÚNG request đó bằng `curl` trực tiếp tới `https://rpc.testnet.arc.network` → RPC trả `200 OK` bình thường trong 0.49s — xác nhận RPC không down.
- Đọc thẳng source `node_modules/viem/utils/rpc/http.ts`: khi `fetch()` của trình duyệt tự throw (mất mạng/RPC không phản hồi tạm thời — KHÔNG phải lỗi HTTP thật), viem vẫn bọc thành `HttpRequestError` nhưng **không có `status`** (chưa nhận được response nào để đọc). `withRetry429()` trong `eventScan.ts` và `isRateLimited()` trong `rpcRetry.ts` trước đó CHỈ retry khi `status === 429`, nên loại lỗi mạng thoáng qua này rớt thẳng, không thử lại lần nào.
- Đã sửa cả 2 file: retry thêm cả trường hợp `status === undefined`, giữ nguyên số lần retry (5) + backoff cũ (không retry vô hạn).
- **Nhiều khả năng đây mới là nguyên nhân THẬT của bug bill 36** (Profile không hiện bill vừa trả, phải reload vài lần) đã note ở update trước — thay thế giả thuyết "`MAX_CHUNKS` cache cap" (chưa từng verify trực tiếp, chỉ đọc code suy luận). Chủ dự án đã xác nhận coi bill 36 là fix qua hướng này.
- Giả thuyết `MAX_CHUNKS` cache cap trong `eventScan.ts` (xem update trước) **vẫn còn tồn tại về lý thuyết, chưa fix** — nhưng ưu tiên thấp hơn nhiều sau khi bug retry mạng đã sửa. Chỉ cần xem lại nếu "profile không hiện bill mới trả" tái diễn SAU commit `0ead92b`.

**Trạng thái push (tính đến cuối session này):** commit `8b2cde4` và `0ead92b` — kiểm tra `git log origin/main..HEAD` lúc đọc lại file này để biết chắc đã push hay chưa.

**How to apply:** Nếu chủ dự án muốn bật lại Circle email login, chỉ cần đổi `NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN=true` trong `.env.local` (đảm bảo SMTP Circle Console đã sửa xong trước), rồi làm nốt phần verify tx-hash field trong `transaction-status.ts`. Nếu chủ dự án lại báo bug hiển thị Profile/bill tương tự bill 36, **không điều tra lại từ đầu** — kiểm tra trước xem có phải lỗi mạng thoáng qua kiểu "Failed to fetch" hay không (đã có retry rồi nên ít khả năng, nhưng vẫn còn giả thuyết `MAX_CHUNKS` treo lại).

---

## Cập nhật (session sau — dọn repo trước deadline nộp 9/8, verify contract, fix tốc độ tải Profile)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này không chạy lại integration test Base Sepolia → Arc mà Phase 1 còn treo từ đầu file này; các việc dưới đây là dọn dẹp/verify/tối ưu, không phải tiến triển phase.

**1. Dọn repo cho Arc Architects Program (deadline 9/8) — đã commit, CHƯA push lúc viết mục này:**

- Thay `README.md` ở root: từ boilerplate Foundry mặc định sang README thật cho Sabi (mô tả sản phẩm, luồng cross-chain, tech stack, hướng dẫn chạy). Commit `0a0fa23`.
- Xoá dead code Phase 1 không còn dùng: `src/BillHookReceiver.sol`, `test/BillHookReceiver.t.sol`, `test/BillHookReceiverRealData.t.sol`, `script/DeployBillHookReceiver.s.sol` — lý do: `src/bill.sol` (SabiBill, đã deploy thật) tự gọi `receiveMessage()` và decode `BurnMessageV2`, không còn dùng kiến trúc hook receiver riêng của Phase 1 nữa (chính `BillHookReceiver.sol` tự ghi TODO "xóa trước Phase 3" nhưng chưa từng xoá cho tới session này). Xoá kèm boilerplate Foundry mặc định `src/Counter.sol`, `test/Counter.t.sol`. Xoá thêm `script/Counter.s.sol` (ngoài kế hoạch ban đầu — file này import `src/Counter.sol` nên xoá Counter.sol làm `forge build` fail toàn bộ; đã hỏi chủ dự án, chọn xoá luôn). Commit `31380b0`. Verify: `forge build` sạch, `forge test` 20/20 pass (9 SabiBillCrossChain + 11 SabiBill).
- **TUYỆT ĐỐI không đụng:** `script/DeploySabiBill.s.sol`, `broadcast/DeploySabiBill.s.sol/*.json` (log deploy thật), contract `SabiBill` tại `0x192963eBcC9f39C0057597CF3AA7d97c99a83c75` không redeploy/không đổi tên. TODO ở `SabiHeader.tsx:121` và `transaction-status.ts:15,38` giữ nguyên (việc thật còn treo có chủ đích, xem mục Circle login phía trên).

**2. Verify contract source trên Blockscout (Arc Testnet explorer) — đã chạy `forge verify-contract` cho `0x192963eBcC9f39C0057597CF3AA7d97c99a83c75` (`src/bill.sol:SabiBill`, verifier `blockscout`, `https://testnet.arcscan.app/api/`), constructor args đối chiếu khớp đúng với broadcast log thật (`0x3600...0000`, `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275`). Submit thành công (`Response: OK`, GUID `192963ebcc9f39c0057597cf3aa7d97c99a83c756a6ab7c5`). Đây là hành động bên ngoài repo (gọi API Blockscout), không tạo file thay đổi nào để commit — **chưa tự confirm trạng thái verify cuối cùng đã "Verified" hẳn trên explorer hay chưa**, chỉ xác nhận đã submit thành công.

**3. Fix tốc độ tải `/profile` — phần này ĐÃ ĐÚNG NHƯNG SAU ĐÓ BỊ SỬA LẠI, xem mục 4 để biết trạng thái cuối cùng:**

- Fix giữ nguyên, đã verify hoạt động: `PaymentRow` trong `profile.tsx` đổi từ `useEffect`+`useState` sang `useQuery` (`queryKey: ['paymentMethod', txHash]`, `staleTime: Infinity`) để không gọi lại `publicClient.getTransaction()` mỗi lần mount cùng `txHash`.
- **ĐÃ REVERT:** nới `concurrency.ts` từ 2 request/400ms lên 4 request/200ms — **KHÔNG giữ**, xem mục 4.

**4. Điều tra sâu hơn + fix gốc bug "profile không hiện bill" (session tiếp theo, đã commit + push) — đây mới là bug THẬT, không phải do chậm:**

- **Verify thật bằng browser** (console log `[profile-perf]` + Network tab) phát hiện: nới `concurrency.ts` lên 4/200ms ở mục 3 làm RPC public trả **429 hàng loạt** (`-32011 request limit reached`, `-32005 rate limit exceeded`) — kể cả gây lỗi CORS trên production `sabi-arc.vercel.app` (RPC quá tải trả lỗi thiếu header CORS). **Đã revert lại đúng 2 request/400ms** — giá trị này ĐÃ verify an toàn qua thực nghiệm, đừng nới lại nếu không có lý do cụ thể đo được.
- Sau khi hết 429, `/profile` chạy nhanh (~2s) nhưng trả về **0 bill dù ví có bill thật** — không phải bug hiển thị nữa (đã sửa riêng, xem gạch dưới), mà là **bug dữ liệu thật**: `eventScan.ts` lần quét đầu (chưa có cache) chỉ quét lùi 40.000 block gần nhất rồi lưu cache với cursor = latestBlock **bất kể có quét hết lịch sử hay không** — nếu bill nằm xa hơn cửa sổ đó, cache coi như "đã quét xong, 0 kết quả" **vĩnh viễn**, catch-up sau này chỉ đi tới, không bao giờ quay lại quét phần bị bỏ sót.
- **Verify bằng RPC thật** (không đoán): viết script quét full lịch sử (`eth_getLogs` filter theo `organizer` + topic0 `BillCreated`), xác nhận ví `0x9E8CFf3CCE6A4Ba5e233bF013618eA8026AAfC38` ("Bông") có **24 bill thật** (billId 0,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,19,22,23,27,33,34,35,36), trải từ block 50.298.310 (gần deploy block 50.295.105) tới 53.946.434 — cách cutoff lúc quét (54.580.493) tới **~634.000 block**, gấp >15 lần cửa sổ 40.000 block cũ. Xác nhận đúng giả thuyết.
- **Fix gốc — kiến trúc seed file tĩnh** (không thể quét full ~4,27 triệu block trong 1 lần tải trang: RPC giới hạn cứng 10.000 block/request — verify bằng `curl` thật, lỗi `-32614` ở 40.000 — CỘNG rate-limit riêng như trên):
  - `frontend-rk/scripts/build-history-seed.mjs` — script chạy NGOÀI app (node, dùng viem trực tiếp), quét TOÀN BỘ lịch sử 3 event (BillCreated không lọc organizer, SharePaid, SlotFilled) từ `SABI_BILL_DEPLOY_BLOCK` tới latest, chunk 10.000 block, có checkpoint tự resume (`scripts/.seed-checkpoint.json`, **KHÔNG commit** — file tạm, gitignore không sửa nên chỉ đơn giản không `git add`). Output: `frontend-rk/public/data/onchain-history-seed.json` (đã commit, ~34KB, 130 log tính tới lúc quét 2026-07-31, `cutoffBlock: 54580493`). **Không cần re-run định kỳ** — catch-up runtime tự quét tiếp phần sau cutoff, seed chỉ là nền lịch sử cũ 1 lần.
  - `logCache.ts`: thêm field `logIndex` (bắt buộc để dedup đúng — xem dưới) + `version: 2`; cache ghi bởi format cũ (thiếu `logIndex`) bị coi như KHÔNG có (`loadCachedLogs` trả `null`) — an toàn vì dữ liệu cũ giờ nằm trong seed rồi, không mất gì.
  - `eventScan.ts`: load seed 1 lần (memoized, fetch `/data/onchain-history-seed.json`), gộp seed + cache local (giờ chỉ lưu phần SAU cutoff seed, không chép lại seed vào localStorage) + log quét mới, **dedup bằng cặp `(transactionHash, logIndex)`** — KHÔNG dùng riêng `txHash` (1 tx có thể emit nhiều log cùng loại nếu sau này có hàm batch) và KHÔNG cắt theo block range (seed/cache có thể chồng lấn phạm vi). Gộp luôn 2 nhánh "cold scan lùi" và "catch-up tới" cũ thành 1 mô hình duy nhất: luôn quét TỚI từ `max(cache cursor, seed cutoff)` — xoá hẳn bug class "cửa sổ hẹp bị kẹt vĩnh viễn".
- **Fix riêng, độc lập:** `useProfileData.ts`/`profile.tsx` trước đó nuốt lỗi im lặng — khi `fetchProfileData` throw (vd RPC hết retry), UI hiện "Chưa tạo bill nào." như thật dù là lỗi. Thêm `isError`+`refetch`, hiện banner vàng + nút "Thử lại" (`profile.load_error`, `profile.retry` trong `common.json` vi/en).
- **Đã verify end-to-end:** build production sạch (`npm run build`), seed file serve đúng qua dev server, chủ dự án xác nhận trên browser thật (sau khi restart dev server + xoá `.next`) `/profile` hiện đúng bill — có gặp 1 React hydration warning (dev-mode only, ở `FaucetMenu` trong `SabiHeader.tsx`, KHÔNG đụng tới trong session này, không phải bug thật, nội dung trang vẫn đúng phía sau overlay).
- **Phát hiện phụ, đã báo không tự sửa:** file `.env` ở ROOT repo (khác `frontend-rk/.env.local`) có `PRIVATE_KEY` thật dạng plaintext + `NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN=true` không comment + 1 dòng bị dính (`HOOK_RECEIVER` và `NEXT_PUBLIC_SABI_BILL_ADDRESS` chung dòng, thiếu xuống dòng). Đã verify: nằm trong `.gitignore`, `git ls-files` xác nhận KHÔNG được track — không lộ lên GitHub. Không tự sửa vì chứa secret, để chủ dự án tự quyết.
- Nút "Sign in with email" từng thấy dai dẳng ở localhost dù `.env.local` đã comment flag — root cause: Next.js đóng cứng biến `NEXT_PUBLIC_*` vào bundle lúc `next dev` KHỞI ĐỘNG, sửa `.env.local` không tự áp dụng, phải tắt hẳn terminal + chạy lại (không chỉ save/reload). Không phải bug code.

**Việc còn pending / TODO chưa chốt (tính đến cuối session này):**

- Xác nhận trạng thái "Verified" cuối cùng của contract trên `https://testnet.arcscan.app/address/0x192963eBcC9f39C0057597CF3AA7d97c99a83c75` — chỉ mới xác nhận submit `forge verify-contract` thành công (mục 2), chưa xác nhận Blockscout xử lý xong.
- File `.env` ở root chứa `PRIVATE_KEY` thật — chủ dự án có thể muốn dọn/rotate key, chưa có quyết định.
- Seed file (`onchain-history-seed.json`) đứng yên ở `cutoffBlock: 54580493` (2026-07-31) — về mặt kỹ thuật KHÔNG bắt buộc re-run (catch-up runtime tự lo phần sau), nhưng nếu muốn giảm việc catch-up cho user hoàn toàn mới sau này, có thể chạy lại `node scripts/build-history-seed.mjs` trong `frontend-rk` (tự resume nhờ checkpoint local, không mất tiến độ cũ nếu checkpoint còn).

**How to apply:**
- `concurrency.ts` hiện tại (2 request/400ms) đã verify AN TOÀN qua thực nghiệm thật (từng nới lên 4/200ms và thấy 429 dội thật) — không nới lại nếu không đo được bằng chứng cụ thể.
- Nếu sau này có bug kiểu "log/event on-chain bị thiếu trong UI", **kiểm tra trước xem seed file có đang được load đúng không** (`fetch('/data/onchain-history-seed.json')`, xem `cutoffBlock`) trước khi nghi ngờ logic quét — đây là lớp nền dữ liệu mới, khác hẳn kiến trúc "chỉ quét cửa sổ gần nhất" trước đây.
- Dedup log LUÔN dùng `(transactionHash, logIndex)`, không bao giờ dùng riêng `txHash` hay cắt theo block range — nếu thêm event type mới vào seed/cache sau này, giữ nguyên nguyên tắc này.

---

## Cập nhật (session sau — thêm tính năng Share bill, điều tra 1 lần RPC blip)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ đụng `frontend-rk/`, không chạy lại test Solidity/Foundry, không có bằng chứng mới về integration test Base Sepolia → Arc mà Phase 1 còn treo từ đầu file này.

**1. Tính năng "Chia sẻ bill" ở trang chi tiết bill (`frontend-rk/src/pages/bill/[id].tsx`) — ĐÃ XÂY XONG, đã verify bằng Playwright (cài tạm ở scratchpad, không phải dependency của repo):**

- File mới `frontend-rk/src/components/ShareBillSheet.tsx` — bottom sheet chia sẻ, dùng chung component `Modal`-style overlay tự vẽ (không tái dùng `Modal.tsx` có sẵn vì cần animation slide-up từ dưới, khác kiểu centered card).
- Nút "Share bill" (gradient tím, theo đúng demo HTML chủ dự án gửi) đặt ngay dưới `ReceiptCard`, bọc chung 1 `<div>` để không phá vỡ CSS `.sabi-grid-detail > *:first-child/*:last-child` (dùng để đảo thứ tự panel trên mobile).
- `shareText` lấy tên người tạo bill thật (`organizer` address → tra `profileName` qua Firestore, tái dùng đúng pattern `useProfilesSync` đã có sẵn cho payer, chỉ thêm 1 lệnh gọi hook nữa sau khi `bill` load xong — không gộp chung vào `profileAddresses` cũ vì lúc đó `bill` chưa tồn tại theo thứ tự hook trong function).
- **2 biến thể tuỳ thiết bị** (chốt sau nhiều vòng hỏi lại với chủ dự án, xem lý do dưới):
  - **Desktop** (`isMobile=false`): chỉ 3 nút — Telegram, Mail (2 URL scheme thật, pre-fill được text+link), + 1 nút "Copy link" chung.
  - **Mobile fallback** (`isMobile=true`, dùng khi trình duyệt mobile KHÔNG hỗ trợ `navigator.share()`): đầy đủ 7 nút — Telegram, WhatsApp, Discord, X, Messenger, Zalo, Mail. Discord/X/Messenger/Zalo không có URL scheme public để pre-fill nên dùng chung 1 hành động copy-link + toast riêng từng platform.
  - `isMobile` xác định bằng regex `userAgent` (`/Android|iPhone|iPad|iPod/i`), tính 1 lần trong `bill/[id].tsx`, truyền prop xuống — KHÔNG dùng `navigator.share` tồn tại hay không để suy ra mobile (lý do ngay dưới).
- **`navigator.share()` (native OS share) CHỈ gọi khi `isMobile === true`** — trước đó chỉ check `navigator.share` tồn tại, nhưng Windows Edge/Chrome cũng implement Web Share API: gọi trên desktop sẽ bật share dialog CỦA WINDOWS (kéo theo Facebook/LinkedIn/Outlook/"WhatsApp Install"/Unigram-giả-làm-Telegram — toàn bộ app đã đăng ký trên máy đó, không kiểm soát được icon/tên/thứ tự). Chủ dự án đã xác nhận qua ảnh chụp thật, chốt: desktop LUÔN dùng sheet tự vẽ, native share chỉ dành cho mobile thật.
- **Giới hạn nền tảng đã giải thích rõ cho chủ dự án, KHÔNG cố gắng khắc phục (không có API public để làm được):**
  - **X (Twitter):** không có link công khai mở thẳng phần nhắn tin (DM) kèm sẵn text — X chỉ có intent "soạn tweet công khai" (`twitter.com/intent/tweet`). Đã chốt: X dùng copy-link fallback giống Discord/Messenger/Zalo.
  - **Discord:** không có URL scheme public để mở picker chọn kênh/người từ web. Lý do vì sao Procreate làm được (chủ dự án hỏi trực tiếp): Procreate là app native, gọi thẳng share sheet CỦA HĐH (iOS Share Sheet), và Discord có "Share Extension" chính thức cắm vào đó, chạy trong process của Discord (có sẵn session đăng nhập) nên tự vẽ được UI chọn kênh. Web không chạm được share sheet đó trừ khi cũng gọi `navigator.share()` — nhưng làm vậy sẽ kéo theo toàn bộ app hệ thống (giống vấn đề desktop ở trên), không cherry-pick được "chỉ hiện Discord". Xây Discord Bot thật (OAuth2 + bot server-side) là hướng duy nhất khác nhưng NGOÀI SCOPE, chưa làm.
  - **Telegram + `localhost` không hiện link xanh:** test lúc dev dùng `http://localhost:3000/...` — Telegram không auto-link hostname `localhost` (không có domain/TLD thật). Sẽ tự hết khi deploy domain thật (vd `sabi-arc.vercel.app`), không phải bug code.
- File đổi: `frontend-rk/src/pages/bill/[id].tsx`, `frontend-rk/src/components/ShareBillSheet.tsx` (mới), `frontend-rk/public/locales/{en,vi}/common.json` (thêm namespace `share_*` trong `bill`).
- **Verify:** cài Playwright tạm thời trong scratchpad session (KHÔNG thêm vào `package.json`/`node_modules` của repo) vì môi trường không có sẵn `chromium-cli`; chạy headless Chromium thật, chụp screenshot xác nhận cả 2 biến thể (desktop 3 nút, mobile 7 nút đúng thứ tự Telegram→Discord/WhatsApp→X→Messenger→Zalo→Mail), xác nhận toast "Copied — paste into X/Discord" hiện đúng, xác nhận link Telegram build đúng `encodeURIComponent` với tên người tạo thật lấy từ Firestore. **Chưa test bằng điện thoại thật** — chỉ giả lập UA + viewport iPhone qua Playwright, hành vi `navigator.share()` thật trên Android/iOS thật (có hiện đúng Discord/WhatsApp trong share sheet gốc hay không) CHƯA verify bằng máy thật.

**2. Điều tra RPC "Failed to fetch" ở trang chi tiết bill — CHỈ ĐIỀU TRA, KHÔNG SỬA CODE (không đủ căn cứ để sửa):**

- Chủ dự án báo lỗi 1 lần: Next.js dev overlay hiện `HttpRequestError` cho `eth_blockNumber` tới `rpc.testnet.arc.network`, kèm badge "1 Issue" ở góc trái — nhưng trang vẫn render bình thường (không crash).
- Xác định: đây gần chắc là lỗi trong `fetchSharePayers` (gọi `publicClient.getBlockNumber()` trực tiếp, có try/catch nên không crash UI, chỉ `console.error`) — Next.js dev mode tự "vợt" `console.error` vào khay Issues, không phải crash thật. Hàm này KHÔNG có retry ở lần gọi đầu tiên lúc mount trang (retry 6s chỉ chạy sau khi có người trả tiền thành công).
- Chủ dự án xác nhận: **chỉ xảy ra 1 lần, F5 là hết** — kết luận đây là RPC public bị nghẽn thoáng qua 1 lần, không phải lỗi lặp lại có hệ thống. **Không sửa code** — nếu tái diễn thường xuyên sau này, cần thêm retry cho lần gọi đầu ở `fetchSharePayers`/`fetchContributions` (hiện chỉ retry sau khi trả tiền thành công, chưa retry lúc mount).

**Việc còn pending / TODO chưa chốt (tính đến cuối session này):**

- Test tay bằng điện thoại thật cho nút Share bill (native share sheet có đúng hiện Discord/WhatsApp/Telegram như kỳ vọng không) — chưa làm được vì môi trường chỉ có Playwright giả lập UA, không phải thiết bị thật.
- Nếu lỗi "Failed to fetch" ở `eth_blockNumber` tái diễn nhiều lần (không phải 1 lần rồi hết), cần quay lại thêm retry cho `fetchSharePayers`/`fetchContributions` ở lần gọi đầu lúc mount — hiện chưa làm vì chủ dự án xác nhận chỉ xảy ra 1 lần.

**How to apply:** Khi sửa tiếp `ShareBillSheet.tsx`, nhớ 2 biến thể `isMobile` khác hẳn nhau về SỐ LƯỢNG nút (không chỉ ẩn/hiện native share) — đừng gộp lại thành 1 danh sách chung nếu chủ dự án không yêu cầu lại. Nếu có thêm nền tảng share mới, kiểm tra trước xem nền tảng đó có URL scheme public để pre-fill hay không trước khi giả định — 3/4 nền tảng "phổ biến" (Discord, X, Messenger, Zalo) đã xác nhận KHÔNG có, chỉ copy-link được.

---

## Cập nhật (session sau — xây lại landing page v2: nav, i18n thật, Process/Stats/FAQ)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ đụng `frontend-rk/`, không chạy lại test Solidity/Foundry.

**Bối cảnh:** Landing page cũ (`frontend-rk/src/pages/index.tsx`) chỉ có Hero + 3 Use Case, KHÔNG có nav, KHÔNG có i18n, KHÔNG có Process/Stats/FAQ — handoff mới (demo `sabi-landing-v2-demo.html`) yêu cầu thêm toàn bộ phần này. 3 quyết định đã hỏi lại chủ dự án trước khi code (AskUserQuestion), đều chọn phương án đầy đủ:
1. Feedback: chưa có link Google Form thật → dùng placeholder `href="#"` + comment TODO rõ ràng trong `index.tsx`, chờ chủ dự án tạo form.
2. i18n EN/VI: làm THẬT ngay (không khoá cứng EN), dùng đúng `next-i18next` đã có sẵn trong app (không viết dictionary riêng).
3. Stats: nối data thật từ on-chain ngay (không để mock).

**1. Nav mới trên landing:** Faucet (link thẳng `https://faucet.circle.com/`, `target=_blank` — ĐƠN GIẢN hơn `FaucetMenu` dropdown của `SabiHeader.tsx` dùng ở các trang app khác, cố ý khác vì landing là trang marketing nhẹ, không cần dropdown 3-chain-gas). Feedback: placeholder chờ link thật. Dropdown ngôn ngữ: **export thêm `LocaleSwitcher` từ `SabiHeader.tsx`** (trước đó là hàm private trong file) để landing tái dùng đúng 1 cơ chế đổi locale (`router.push` với `locale`), không viết lại.

**2. i18n thật cho toàn bộ landing:** thêm `getServerSideProps` (`serverSideTranslations`) + namespace `landing.*` mới trong `public/locales/{en,vi}/common.json` (~50 key: nav, hero, use case, process 4 bước, stats, FAQ). Hero + Use Case giữ nguyên MÀU đã duyệt trước đó (`c.accent`/`c.heading`/... trong `index.tsx`, khác `theme.ts` chung của app) — chỉ đổi string sang `t()`, không đổi style. `process_foot` tách thành 3 key (`_pre`/`_bold`/`_post`) thay vì nhúng `<b>` trong 1 string dịch, để tránh phải dùng `dangerouslySetInnerHTML`.

**3. Section Process + Stats (mới hoàn toàn, không có trước đây):**
- Process: card nền đen, 4 bước, track/packet chạy bằng CSS keyframes thuần (không cần JS).
- Stats: card nền tím gradient, 4 tile. "Bills created" + "USDC settled" nối data thật qua hook mới `frontend-rk/src/hooks/useLandingStats.ts` — quét TOÀN BỘ lịch sử on-chain (không lọc theo ví, khác `useProfileData.ts`), dùng cacheKey riêng (`sabi-scan-*-landing`), tái dùng `scanEventLogs` có sẵn. "Source chains" (3) và "Avg settlement" (~20s) là thông tin sản phẩm CỐ ĐỊNH, không phải số đọc chain.
- Reveal-on-scroll + count-up viết bằng `IntersectionObserver` + `requestAnimationFrame` thuần trong React (component `StatTile`), không thêm dependency ngoài.

**4. Bug tìm thấy + fix trong lúc build Stats (verify bằng curl thật, không đoán):**
- `useLandingStats` bị lỗi "Failed to fetch" (CORS-looking, cùng loại đã biết — RPC public quá tải nhất thời trả response thiếu header CORS, KHÔNG phải RPC down thật, verify bằng `curl OPTIONS` giả lập preflight nhiều lần thấy có lúc pass có lúc fail). Đã thêm retry riêng (`getBlockNumberWithRetry`, 3 lần, backoff) cho lần gọi `getBlockNumber()` đầu tiên trong hook MỚI này — khác quyết định trước đó là KHÔNG đụng `fetchSharePayers`/`fetchContributions` cũ trong `bill/[id].tsx` (những chỗ đó chủ dự án đã xác nhận chỉ lỗi 1 lần, để nguyên).
- Landing page quét GLOBAL (không lọc theo bill/ví) nên catch-up nặng hơn hẳn các trang khác — đã chạy lại `node scripts/build-history-seed.mjs` để đẩy `cutoffBlock` từ 54580493 (31/7) lên 55089050 (3/8, 149 log), giảm gap catch-up từ ~408k xuống gần 0 block, cải thiện tốc độ tải lần đầu. Không đụng code, chỉ regenerate `public/data/onchain-history-seed.json`.
- Số liệu thật xác nhận qua browser: 47 bills created, 296 USDC settled (tính tới lúc quét 3/8).

**5. Fix nhỏ sau khi chủ dự án báo qua screenshot:** bản dịch tiếng Việt của heading "Process" dài hơn bản Anh, bị wrap để lại 1 từ ("xong") mồ côi dòng riêng (do `max-width: 560px` cố định từ demo gốc, hợp với string Anh ngắn hơn). Fix bằng `text-wrap: balance` (CSS thuần, browser tự cân dòng khi bắt buộc wrap) — áp dụng cho MỌI heading tương tự đã viết trong session này (hero `.headline`, `.usecases-heading`, `.card-head h2`, `.stat-head h2`, `.faq-head h2`), không chỉ chỗ bị báo, vì cùng chung rủi ro giữa 2 ngôn ngữ.

**6. Nội dung FAQ đã đổi 2 LẦN trong session này theo yêu cầu chủ dự án — bản CUỐI CÙNG (4 câu, câu 1 mở mặc định):**
1. What is Sabi? / Sabi là gì?
2. Why do you need Sabi instead of a bank transfer or sending crypto directly? / Tại sao bạn cần Sabi thay vì chuyển khoản ngân hàng hoặc tự send crypto bình thường?
3. What's the difference between ASSIGNED and OPEN_SLOT? / Sự khác nhau giữa ASSIGNED và OPEN_SLOT là gì?
4. How is Sabi different from a typical bridge? / Sabi khác gì so với các bridge thông thường?

(Bản đầu tiên có "What is CCTP"/"Which chains"/"gas fees" đã bị THAY HẾT — nếu thấy các câu đó ở đâu khác trong code/note cũ thì đã lỗi thời, dùng đúng 4 câu trên.)

**Gotcha xác nhận lại lần nữa trong session này:** next-i18next cache locale JSON phía server RẤT DAI — sau khi sửa `common.json`, `kill` port 3000 vẫn CHƯA đủ nếu còn tiến trình `node.exe` con nào sống sót (thấy 3 tiến trình `node.exe` cùng lúc, chỉ 1 cái LISTEN cổng 3000 nhưng phải kill CẢ 3 mới hết stale). Luôn `tasklist /FI "IMAGENAME eq node.exe"` + kill hết trước khi tin là đã "restart sạch".

**File đổi trong session này:** `frontend-rk/src/pages/index.tsx` (viết lại gần như toàn bộ), `frontend-rk/src/hooks/useLandingStats.ts` (mới), `frontend-rk/src/components/SabiHeader.tsx` (export `LocaleSwitcher`), `frontend-rk/public/locales/{en,vi}/common.json` (namespace `landing.*`), `frontend-rk/public/data/onchain-history-seed.json` (regenerate).

**Việc còn pending:**
- Dán link Feedback Google Form thật khi chủ dự án tạo xong (TODO trong `index.tsx`, tìm `href="#"` ở nav-link Feedback).
- Seed file sẽ lại lùi dần theo thời gian — không bắt buộc re-run định kỳ (catch-up runtime tự lo), nhưng nếu muốn landing luôn tải nhanh có thể chạy lại `build-history-seed.mjs` trước các mốc quan trọng (demo, deadline nộp bài).

**How to apply:** Nếu chủ dự án đổi nội dung FAQ/copy landing LẦN NỮA, chỉ cần sửa locale JSON (namespace `landing.*` trong `common.json`) — KHÔNG cần đụng `index.tsx` trừ khi đổi SỐ LƯỢNG câu FAQ (component `FaqSection` hiện hardcode mảng `[1,2,3,4]` theo số thứ tự key `faq_qN`/`faq_aN`).

---

## Cập nhật (session sau — fix heading Process bị wrap ở bản VI)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa CSS 1 chỗ.

`text-wrap: balance` (thêm ở session trước) chỉ CHIA ĐỀU các dòng khi bắt buộc phải wrap, KHÔNG giúp fit vừa 1 dòng — chủ dự án báo heading "Từ ví của bạn đến bill đã thanh toán xong" (VI) vẫn xuống 2 dòng vì `.card-head` (trong Process section, `index.tsx`) có `max-width: 560px` cứng từ demo gốc (đủ cho bản Anh ngắn hơn, không đủ cho bản Việt dài hơn).

**Fix:** bỏ hẳn `max-width: 560px` khỏi `.card-head` (để h2 dùng full chiều rộng card, tự nhiên bị giới hạn bởi padding của `.card-dark` + `.page{max-width:1080}`), chuyển `max-width: 620px` sang riêng `.card-head p` (subtitle) để đoạn văn vẫn không quá rộng khó đọc. Verify bằng Playwright đo `boundingBox` của h2: height 40.5px (đúng 1 dòng) cho cả EN và VI, trước đó VI cao gấp đôi (2 dòng).

**Lưu ý nếu heading nào khác sau này cũng bị wrap không mong muốn:** kiểm tra xem có đang bị `max-width` cố định nào bóp hẹp không trước khi chỉ dựa vào `text-wrap: balance` — 2 công cụ giải quyết 2 vấn đề khác nhau (balance = chia đều khi PHẢI wrap; nới max-width = tránh phải wrap).

**Phát hiện phụ, CHƯA sửa (không phải do session này gây ra):** `landing.process_step4_desc` bản VI trong `common.json` có lỗi gõ — thiếu dấu cách "kháclên" (đúng ra "khác lên") + có 1 khoảng trắng thừa cuối câu ("...chỉ 20s "). Đây là nội dung chủ dự án tự sửa tay ngoài phiên làm việc (không phải AI viết), đã báo lại trong chat, chưa tự sửa vì không chắc có phải lỗi hay cố ý. **Cập nhật: chủ dự án xác nhận đã tự sửa lỗi này rồi ở session sau — không còn pending.**

---

## Cập nhật (session sau — nội dung Process đổi sang luồng tạo bill, đồng nhất icon, bỏ caption Use Case, chỉnh spacing)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa `frontend-rk/src/pages/index.tsx` + 2 file locale, không chạy lại test Solidity/Foundry.

Handoff mới (`sabi-landing-v2-demo.html` + note trong chat, không phải file trong repo) yêu cầu 4 việc:

1. **Nội dung Process đổi từ luồng thanh toán sang luồng TẠO bill** — trước đó 4 bước mô tả "chọn chain giữ USDC / ASSIGNED·OPEN_SLOT / ký 1 giao dịch / CCTP Fast Transfer 20s" (luồng người TRẢ tiền), giờ đổi thành luồng người TẠO bill: Connect wallet → Create a bill (Open Slot chia đều/Assigned gán số tiền) → Share the link → Check the bill (theo dõi ai đã trả). Đồng thời **bỏ hẳn 4 chip phụ** dưới mỗi bước (`Base · Arbitrum · Ethereum`, `ASSIGNED · OPEN_SLOT`, `1 signature · no swap`, `~20 seconds`) theo đúng yêu cầu chủ dự án — lý do nêu rõ trong handoff: "không đều nhau về nội dung nên bỏ, không cần khôi phục". Card footer đổi theo: "Every bill lives at **one link** — Sabi handles the cross-chain settlement via Circle CCTP V2." (VI: "Mỗi bill chỉ cần **1 link** — Sabi lo phần settle cross-chain qua Circle CCTP V2.").
2. **Đồng nhất màu icon cả 4 bước Process** — trước đó bước 4 ("Check the bill"/lúc đó còn tên "Settled on Arc") có override riêng: icon nền/viền trắng, số thứ tự nền trắng chữ đen, packet animation (chạy dọc track) kết thúc màu trắng thay vì tím — không khớp 3 bước đầu (tông tím nhạt `rgba(153,142,255,...)`). Đã xoá toàn bộ override `.step:last-child .step-icon`/`.step:last-child .step-num`/`.step:last-child .step-chip` (chip đã xoá theo mục 1), sửa `@keyframes travel` mốc `100%` từ `background: white` sang `background: ${c.accent}` (#998EFF) + box-shadow tương ứng — cả 4 bước giờ dùng chung 1 style, không có ngoại lệ.
3. **Use Case — bỏ dòng caption cuối** `"Arc Testnet · settles in ~20 seconds"` (key `landing.usecase_caption`) theo yêu cầu chủ dự án — đã xoá cả JSX (`<p className="usecases-caption">`) lẫn CSS class `.usecases-caption` (orphan do chính thay đổi này gây ra) lẫn key trong 2 file locale.
4. **Chỉnh spacing Use Case → Process bằng Process → Stats:** trước đó `.usecases` có `padding: 32px 24px 80px` (bottom 80px) trong khi khoảng cách giữa khối Process (nền đen) và Stats (nền tím) chỉ có 56px (28px bottom-padding của `.block-wrap` bọc Process + 28px top-padding của `.block-wrap` bọc Stats) — nhìn mắt thường thấy Use Case→Process rộng hơn hẳn. Fix: đổi `.usecases` bottom-padding từ 80px xuống 28px, khớp đúng số liệu trong demo (`sabi-landing-v2-demo.html` có `.usecase { padding: 20px 0 28px; }`).

**Verify (Playwright, cài tạm ở scratchpad, không phải dependency repo):**

- Đo bằng `getBoundingClientRect()`: khoảng cách từ `.usecases-grid` (card use case cuối) tới card Process = 56px, khoảng cách từ card Process tới card Stats = 56px — **bằng nhau đúng như yêu cầu**, đo cho cả 2 locale (EN/VI).
- Chụp screenshot full-page cả EN/VI xác nhận: Process không còn chip nào, cả 4 icon dùng chung tông tím (không còn icon trắng riêng ở bước 4), heading VI "Từ ví của bạn đến bill đã thanh toán xong" vẫn giữ đúng 1 dòng (fix từ session trước không bị ảnh hưởng bởi thay đổi lần này).
- `npx tsc --noEmit` sạch, không lỗi TypeScript.
- Phần Stats hiện trắng/rỗng trong screenshot full-page — đây là do `IntersectionObserver` chưa kịp fire lúc chụp ảnh full-page (hành vi reveal-on-scroll có sẵn từ session trước, không phải regression do session này gây ra, không nằm trong scope sửa).

**File đổi:** `frontend-rk/src/pages/index.tsx` (component `ProcessSection`: bỏ field `chip` khỏi mảng `steps`, bỏ JSX `.step-chip`, bỏ CSS `.step-chip`/`.step:last-child *`, sửa `@keyframes travel`; bỏ JSX + CSS `.usecases-caption`; đổi `.usecases` padding-bottom), `frontend-rk/public/locales/{en,vi}/common.json` (đổi nội dung `process_step1-4_title/desc`, `process_foot_pre/bold/post`; xoá key `process_step1-4_chip` và `usecase_caption`).

**Việc còn pending (không đổi so với trước, session này không chạm tới):** dán link Feedback Google Form thật; test tay điện thoại thật cho Share bill; theo dõi RPC "Failed to fetch" có tái diễn không.

**How to apply:** Nếu chủ dự án đổi nội dung Process/Use Case lần nữa, sửa trực tiếp `common.json` namespace `landing.*` là đủ (không cần đụng `index.tsx` trừ khi đổi cấu trúc — vd thêm lại chip hoặc đổi số bước). Nếu cần fix phần Stats hiện trắng trong screenshot full-page sau này, nhớ đây là do `IntersectionObserver` + full-page screenshot, không phải bug — muốn chụp đúng phải cuộn thật qua từng phần trước khi chụp, không chỉ resize viewport.

---

## Cập nhật (session sau — tăng độ ổn định `/profile`: retry getBlockNumber + gộp getTransaction vào rate-limiter chung)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa 3 file `frontend-rk/`, không chạy lại test Solidity/Foundry.

**Bối cảnh:** Chủ dự án báo `/profile` thỉnh thoảng hiện banner "Couldn't load on-chain history (RPC error or overloaded)" + cảm giác load chậm, muốn "trị dứt điểm". Điều tra bằng đọc code + gọi RPC thật (không đoán):

1. **Verify seed file KHÔNG phải nguyên nhân:** `cutoffBlock` seed (`onchain-history-seed.json`) = 55.089.050, latest block lúc kiểm tra = 55.105.619 — gap chỉ ~16.569 block (2 chunk, dưới `MAX_CHUNKS=4`), không phải bug "catch-up quá xa" như từng gặp trước đây. `curl`/script `getContractEvents` trực tiếp cho đúng 2 chunk cần quét của cả 3 event: tất cả trả về nhanh (<1.3s), 0 lỗi — RPC đang khoẻ tại thời điểm test, nên lỗi chủ dự án gặp là **gián đoạn/tải cao không liên tục**, không phải hỏng vĩnh viễn.
2. **Đọc thẳng source viem** (`node_modules/viem/_esm/utils/buildRequest.js`, hàm `shouldRetry`) để hiểu tầng retry có sẵn: transport `http()` mặc định ĐÃ tự retry 3 lần (backoff ngắn ~150-600ms) cho cả lỗi 429 lẫn lỗi `status undefined` (mất mạng thoáng qua — do `if (error.status)` là truthy-check, `undefined` lọt qua nhánh đó rơi xuống `return true` ở cuối hàm). Nghĩa là **mọi lệnh RPC trong app đều đã có sẵn ~1 giây retry miễn phí từ viem**, kể cả trước khi có `withRetry429` custom của app. Điều này làm rõ: lớp `withRetry429` (5 lần, backoff tới ~25s) trong `eventScan.ts`/`rpcRetry.ts` là lớp PHÒNG THỦ THỨ HAI, không phải thứ nhất — chỉ những lệnh KHÔNG được bọc lớp thứ hai này mới thực sự mong manh (chỉ có ~1s đệm thay vì ~25s).
3. **Xác định đúng 2 lệnh RPC "mong manh"** kiểu trên trong luồng `/profile`:
   - `useProfileData.ts` → `fetchProfileData()` gọi `publicClient.getBlockNumber()` **trần, không có lớp retry thứ 2** — khác `useLandingStats.ts` đã có `getBlockNumberWithRetry` riêng cho đúng lệnh tương tự. 1 lần RPC nghẽn thoáng qua (>~1s) đúng lúc gọi lệnh ĐẦU TIÊN này là toàn bộ `fetchProfileData` throw ngay, React Query chỉ retry thêm 1 lần theo default (`_app.tsx`, không riêng cho profileData) → dễ thành `isError=true`, đúng banner chủ dự án thấy.
   - `profile.tsx` → `PaymentRow` mỗi dòng "Bill đã trả" tự gọi `publicClient.getTransaction()` **riêng, không qua `withGlobalConcurrency`** (rate-limiter chung 2 request/400ms dùng cho quét log) — list càng nhiều bill càng nhiều request bắn đồng thời, KHÔNG được điều phối cùng các request quét log khác đang chạy song song trên cùng trang, dễ cộng dồn tải lên RPC hơn mức limiter dự tính.
4. **Đã thử + LOẠI BỎ 1 hướng tưởng sẽ giúp nhưng thực nghiệm cho kết quả ngược lại:** bật JSON-RPC batching (`http(url, { batch: true })`) để gộp nhiều lệnh nhỏ (vd 5 `getTransaction` + 1 `getBlockNumber`) thành 1 HTTP request — RPC `rpc.testnet.arc.network` xác nhận CÓ hỗ trợ batch (`curl` gửi mảng JSON-RPC, nhận đúng mảng kết quả). Nhưng **test thật bằng script viem với 6 lệnh giống hệt luồng `/profile`**: không batch → 6 HTTP request, 0 lỗi; bật `batch:true` → 1 HTTP request nhưng RPC trả lỗi `"request limit reached"` cho 3/6 lệnh trong batch; bật `batch:{wait:20}` → 6/6 lệnh lỗi. Kết luận: RPC public này đếm giới hạn theo SỐ LỆNH LOGIC trong 1 batch chặt hơn hẳn so với cùng số lệnh gửi rời rạc — **batching là hướng phản tác dụng cho đúng RPC này, đã loại bỏ, KHÔNG áp dụng**. Ghi lại để session sau không thử lại hướng này mà không biết đã test.

**Đã sửa (an toàn, không đổi hành vi UI, chỉ tăng độ chịu lỗi RPC):**
- `eventScan.ts`: export `withRetry429` (trước đó là hàm private, chỉ dùng nội bộ file) — tái dùng logic retry 5 lần/backoff đã có sẵn thay vì viết thêm 1 bản sao thứ 3 (bản thứ 2 là `getBlockNumberWithRetry` riêng trong `useLandingStats.ts`).
- `useProfileData.ts`: bọc `getBlockNumber()` bằng `withRetry429` (import từ `eventScan.ts`).
- `profile.tsx` (`PaymentRow`): bọc `getTransaction()` bằng cả `withGlobalConcurrency` (từ `concurrency.ts`) lẫn `withRetry429` — đưa vào đúng 1 hàng đợi RPC chung với các lệnh quét log của trang, thay vì bắn tự do không kiểm soát.

**Verify:** `npx tsc --noEmit` sạch. Dev server thật: `curl http://localhost:3000/profile` → 200, HTML render đúng trạng thái "Connect wallet to view your profile" (chưa test được trạng thái ĐÃ connect ví vì môi trường không có ví thật/extension, chỉ Playwright giả lập UA — xem mục pending).

**Đánh đổi đã báo cho chủ dự án:** khi list "Bill đã trả" dài, các lệnh `getTransaction` giờ phải xếp hàng qua rate-limiter chung (2 request/400ms) thay vì bắn đồng thời tự do — có thể chậm hơn một chút so với trước ở trường hợp KHÔNG lỗi, đổi lại giảm khả năng chạm rate-limit khi chạy cùng lúc với phần quét log. Nhất quán với quyết định đã chốt trước đây ở `concurrency.ts` (ưu tiên ổn định hơn tốc độ thô, xem update "dọn repo... fix tốc độ tải Profile").

**Giới hạn thật, KHÔNG thể trị dứt điểm 100%:** đây là RPC public miễn phí của testnet Arc, có thể nghẽn thật sự lâu hơn cả tổng thời gian retry app-level (~25s cộng dồn) trong trường hợp xấu nhất — banner lỗi + nút "Retry" vẫn là lớp chống cuối, không loại bỏ hoàn toàn được khả năng này, chỉ giảm tần suất. Đã nói rõ với chủ dự án, không hứa quá mức.

**Ghi nhận phụ, không phải do session này:** `bill.allow_sabi_usdc` bản EN trong `common.json` được chủ dự án tự sửa tay ngoài phiên làm việc (từ "Allow Sabi to use USDC" → "Approve Sabi to use USDC") — không liên quan tới fix RPC, không tự đổi lại.

**Việc còn pending:**
- Test tay bằng ví thật cho `/profile` sau khi đã connect (môi trường hiện tại không có ví thật/extension để verify trực tiếp — chỉ verify được bằng đọc code + test RPC trực tiếp + SSR HTML lúc CHƯA connect).
- Theo dõi xem banner lỗi có còn tái diễn thường xuyên sau fix này không — nếu vẫn tái diễn nhiều, cân nhắc thêm retry cho `useBillsProgress`'s multicall (đã có `rpcRetryQueryOptions` từ trước, không đổi) hoặc xem xét lại `MAX_CHUNKS`/`CHUNK_SIZE` trong `eventScan.ts`.
- **KHÔNG thử lại batching JSON-RPC cho RPC Arc Testnet này** — đã test thực nghiệm và xác nhận phản tác dụng (xem mục 4 phía trên).

**How to apply:** Nếu sau này thêm 1 lệnh RPC đơn lẻ mới (không qua `scanEventLogs`/`useReadContracts`) ở bất kỳ trang nào, luôn bọc bằng `withRetry429` (export từ `eventScan.ts`) tối thiểu — đây là lớp phòng thủ thứ 2 rẻ, không tốn gì khi RPC khoẻ, chỉ có tác dụng khi RPC blip. Nếu lệnh đó có thể lặp lại N lần trong 1 trang (list dài), bọc thêm `withGlobalConcurrency` (từ `concurrency.ts`) để không bắn song song không kiểm soát.

---

## Cập nhật (session sau — đồng bộ màu nút toàn app sang tím, fix Approve/Pay hiện lẫn lộn)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa `theme.ts` + `bill/[id].tsx`.

**1. Đồng bộ màu nút — chủ dự án gửi ảnh nút "Create a bill" (tím `#998EFF`), yêu cầu thay mọi nút đen trong app sang màu này, gồm cả nút Share bill ở bill detail:**
- `theme.ts`: đổi `colors.buttonPrimary` từ `#17151F` (đen) sang `#998EFF` (tím, đúng màu CTA landing), `colors.buttonPrimaryHover` từ `#2B2838` sang `#877DE0`. Đây là token TRUNG TÂM cho mọi nút hành động chính (Tạo bill, Approve, Trả tiền, các modal thanh toán...) — đổi 1 chỗ, cascade tự động khắp app, không cần sửa từng nơi.
- Nút "Share bill" (`bill/[id].tsx`) trước đó dùng gradient RIÊNG (`colors.primary` → `colors.primaryHover`, tông tím đậm/indigo khác hẳn phần còn lại của app) — đổi sang dùng thẳng `colors.buttonPrimary` (phẳng, không gradient), khớp y hệt mọi nút khác.
- Verify: Playwright screenshot xác nhận nút "Connect wallet to create bill" (`/create`) và "Share bill" (`/bill/1`) đều ra đúng `#998EFF`.

**2. Fix bug "Approve USDC"/"Pay" hiện lẫn lộn trong danh sách share cùng 1 bill — chủ dự án gửi ảnh 4 share (Chi=1, Zu=5, Tim=10, Mod=1 USDC): Chi/Zu/Mod hiện "Pay", riêng Tim hiện "Approve USDC":**
- **Root cause xác nhận qua code** (không phải bug hiển thị lệch đồng bộ, là thiết kế cũ gây hiểu lầm): mỗi `ShareRow` so `allowance` (1 giá trị DUY NHẤT theo chuẩn ERC20 cho cả ví, không phải theo từng share) với `share.amount` RIÊNG của chính hàng đó (`hasEnoughAllowance(share.amount)`) — code cũ cố tình approve ĐÚNG số tiền từng giao dịch (không dùng `maxUint256`, an toàn hơn) nhưng cái giá là: nếu allowance hiện tại (vd còn sót 5 USDC từ lần approve trước) đủ cho vài share nhỏ nhưng KHÔNG đủ cho share lớn hơn (Tim=10), UI hiện lẫn Pay/Approve dù cùng 1 allowance thật — đúng như ảnh chủ dự án gửi.
- Chủ dự án xác nhận muốn: tại 1 thời điểm phải đồng nhất (tất cả cùng Pay HOẶC tất cả cùng Approve), không lẫn lộn.
- **Fix:** thread prop `totalAmount` (= `bill.totalAmount`) xuyên suốt `AssignedShares` → `ShareRow`, đổi `needsApprove = !hasAllowance(share.amount)` → `!hasAllowance(totalAmount)`, đổi nút Approve từ `onApprove(share?.amount)` → `onApprove(totalAmount)`. Giờ approve 1 lần là đủ cho TOÀN BỘ bill (không phải riêng share đang bấm), mọi hàng dùng chung 1 threshold nên luôn đồng nhất trạng thái Pay/Approve tại mọi thời điểm.
- Chỉ sửa mode ASSIGNED (`AssignedShares`/`ShareRow`) — mode OPEN_SLOT (`OpenSlotInfo`) không đụng, vì các slot vốn đã dùng chung 1 `amountPerSlot` giống nhau, không có bug tương tự.
- Verify: typecheck sạch. Lúc test bằng Playwright phát hiện bill detail bị "stuck ở Loading bill info..." — đã dùng `git stash` để loại trừ, xác nhận hiện tượng này XẢY RA Y HỆT trên bản gốc CHƯA sửa (không phải regression của fix này) — chính phát hiện này là khởi đầu cho việc điều tra RPC throttling ở mục dưới.

---

## Cập nhật (session sau — bill detail load chậm: cache dùng chung theo bill + regenerate seed)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa `bill/[id].tsx` + regenerate `onchain-history-seed.json`.

Chủ dự án báo "chi tiết bill load info thật sự lâu quá", yêu cầu điều tra.

**Root cause xác nhận (đọc code + đo RPC thật, không suy đoán):** `fetchContributions`/`fetchSharePayers` trong `bill/[id].tsx` dùng cache key RIÊNG theo từng `billId` (`sabi-scan-SlotFilled-bill-${billId}`, `sabi-scan-SharePaid-bill-${billId}`) và lọc server-side theo `billId` (event `SlotFilled`/`SharePaid` có `billId` indexed nên lọc được) — khác hẳn `profile.tsx` (dùng cache key CHUNG `sabi-scan-SlotFilled`/`sabi-scan-SharePaid` cho mọi ví, vì `payer` không indexed nên vốn phải quét hết rồi lọc client). Hệ quả: mỗi bill khác nhau mở lên phải tự quét lại catch-up TỪ ĐẦU (từ cutoff của seed tới block mới nhất) dù CÙNG block range đó vừa quét xong cho bill khác — không chia sẻ được gì cả. Đo trực tiếp lúc điều tra: gap catch-up đã lên **38.952 block** — sát ngưỡng cần đủ 4 chunk (`MAX_CHUNKS=4`, `CHUNK_SIZE=10000`), dễ dính 429 dồn dập mỗi lần mở bill mới.

**Fix:**
- Đổi `fetchContributions`/`fetchSharePayers` sang dùng cache key CHUNG (`sabi-scan-SlotFilled`, `sabi-scan-SharePaid`, khớp đúng `profile.tsx`), quét KHÔNG lọc theo billId ở RPC (`args: undefined`) rồi tự `.filter((log) => log.args.billId === billId)` ở client — chi phí rẻ vì tổng số log toàn app còn nhỏ.
- Bọc `getBlockNumber()` bằng `withRetry429` trong cả 2 hàm (cùng lỗ hổng đã vá ở `useProfileData.ts` trước đó, giờ vá luôn ở đây).
- Chạy lại `node scripts/build-history-seed.mjs` — đẩy `cutoffBlock` từ 55.089.050 lên 55.129.557, gap catch-up về gần 0.

**Verify thật (Playwright, đo bằng console `[profile-perf]`):**
- Mở bill #1 (nguội, chưa có cache): cần 4 chunk, dính vài lỗi 429, quét mất 7.5s.
- Mở bill #2 ngay sau đó: chỉ cần **1 chunk, 319ms** — dùng lại ĐÚNG cache bill #1 vừa quét (cursor tiếp tục từ 55.129.050 thay vì quét lại từ seed floor) — xác nhận cơ chế chia sẻ cache hoạt động đúng như thiết kế.
- Sau khi regenerate seed, mở bill mới (chưa từng cache) chỉ cần 1 chunk (~320ms) thay vì 4 — do gap catch-up đã về gần 0.

**Việc còn pending:** seed sẽ lại lùi dần theo thời gian (không bắt buộc re-run định kỳ, catch-up runtime tự lo phần sau, nhưng nên chạy lại trước các mốc quan trọng — giống ghi chú các session trước).

**How to apply:** Nếu sau này thêm 1 trang mới cũng cần đọc `SharePaid`/`SlotFilled` (hoặc bất kỳ event có filter theo 1 giá trị cụ thể như `billId`), CÂN NHẮC dùng cache key CHUNG + filter client-side thay vì cache key riêng + filter server-side — trừ khi số lượng log thực sự lớn (hàng nghìn+) khiến filter client-side tốn kém, lúc đó filter server-side mới đáng giá hơn việc mất khả năng chia sẻ cache.

---

## RPC throttling trên Arc Testnet — kiến thức tích luỹ từ session debug cùng ngày (tiếp nối session "tăng độ ổn định /profile" phía trên)

Sau khi fix `/profile`, chủ dự án báo cả `/profile` lẫn bill detail đều load chậm bất thường (~20s, đôi khi treo hẳn). Điều tra sâu hơn bằng DevTools Network/Console + đọc source thật (không suy đoán), rút ra 5 điểm sau — áp dụng cho MỌI thay đổi liên quan RPC Arc Testnet sau này:

1. **Batch JSON-RPC phản tác dụng trên `rpc.testnet.arc.network` — đã test thực nghiệm, ĐỪNG dùng:** 6 lệnh RPC gửi rời rạc (không batch) → 6 request riêng, 0 lỗi. Bật `batch: true` (viem `http()` transport) → RPC trả `"request limit reached"` cho 3/6 lệnh trong batch. Bật `batch: { wait: 20 }` → 6/6 lệnh lỗi hết. Kết luận: RPC này đếm giới hạn theo **số lệnh logic bên trong 1 batch**, chặt hơn hẳn so với cùng số lệnh gửi rời rạc. **Không dùng `batch` cho transport Arc trong `wagmi.ts`** — đã thử và bỏ, không thử lại nếu không có bằng chứng RPC đổi chính sách.

2. **429 từ RPC này không kèm CORS header → browser hiển thị nhầm thành "CORS error":** khi debug thấy hàng loạt lỗi `Access to fetch ... blocked by CORS policy` trên `rpc.testnet.arc.network`, mặc định hiểu đây là **rate-limit (429)**, KHÔNG phải lỗi cấu hình CORS thật — đây là quan sát đã lặp lại nhiều lần xuyên suốt các session trước (xem các update cũ về bug "profile không hiện bill", "Failed to fetch").

3. **`RateLimiter(maxConcurrent, minIntervalMs)` trong `concurrency.ts` ĐÃ LÀ rate-limit theo thời gian thực sự, không phải thuần concurrency limiting** — `minIntervalMs` ép khoảng cách tối thiểu giữa các lần **dispatch** (lúc bắt đầu gọi), không phải giữa các lần hoàn thành. Hiện đang set `RateLimiter(2, 400)` (`maxConcurrent=2`, `minIntervalMs=400`) → trần ~2.5 request/giây khi RPC phản hồi nhanh, hoặc bị `maxConcurrent` ghì lại nếu RPC phản hồi chậm (tự chọn constraint chặt hơn giữa 2 cơ chế). **Không đổi sang token bucket** trừ khi mục tiêu là đổi SHAPE traffic (đều đặn hơn, cho phép burst) — token bucket vốn lỏng hơn thiết kế hiện tại (cho burst tới capacity rồi mới throttle), dễ làm TỆ HƠN nếu mục tiêu là giảm tổng rate, không phải đổi shape.

4. **RPC public có thể giữ trạng thái rate-limit riêng theo IP, tích luỹ sau nhiều giờ test dồn dập trong ngày.** Benchmark đo trên 1 IP đã bị heavy-test (như máy dev đã chạy hàng chục script/Playwright test liên tục nhiều giờ trong ngày) **không đáng tin** để kết luận 1 fix có hiệu quả hay không — dễ nhầm "code vẫn lỗi" trong khi thực ra là RPC-side đang throttle riêng IP đó từ lịch sử test trước, không liên quan gì tới code mới. **Cần verify fix liên quan RPC bằng mạng/IP SẠCH** trước khi kết luận — ví dụ: `ngrok http 3000` + điện thoại tắt Wi-Fi dùng 4G, hoặc bật VPN trên máy dev, hoặc đơn giản là đợi 1 khoảng thời gian dài (nhiều giờ) cho RPC-side rate-limit hạ nhiệt rồi test lại.

5. **Fix đã áp dụng (session này):** custom `fetchFn` cho transport Arc Testnet trong `wagmi.ts`, route qua `withGlobalConcurrency` sẵn có trong `concurrency.ts` — bắt được **mọi** request vật lý tới RPC Arc, kể cả từ `useReadContract`/`useReadContracts` của wagmi (`getBill`, `shareCount`, `getShare` multicall, `allowance`...) chứ không chỉ từ `eventScan.ts` như trước. Đồng thời bỏ lớp `withGlobalConcurrency` bọc thủ công dư thừa ở `eventScan.ts` (dòng gọi `getContractEvents`) và `profile.tsx` (`PaymentRow`'s `getTransaction`) — 2 chỗ này trước đó tự bọc riêng, giờ dư thừa vì transport-level fetchFn đã bắt lại từ đầu, giữ cả 2 lớp sẽ khiến 1 lệnh logic chiếm 2 slot của cùng 1 `RateLimiter` (double-throttle, chậm gấp đôi không cần thiết mà không tăng an toàn gì thêm).
   - Code: `wagmi.ts` — `const arcThrottledFetch: typeof fetch = (input, init) => withGlobalConcurrency(() => fetch(input, init))`, truyền vào `http(undefined, { fetchFn: arcThrottledFetch })` CHỈ cho transport `[arcTestnet.id]` (không áp dụng cho Base/Arbitrum/Ethereum Sepolia — RPC khác, giới hạn khác, không có bằng chứng cần throttle).
   - Verify: đã confirm `arcThrottledFetch` THẬT SỰ được wagmi gọi (đo bằng console.log tạm thời, đã dọn sau khi xác nhận — 11 lần fetch trong 5 giây khi mở 1 bill).
   - **CHƯA verify hiệu quả cuối cùng bằng network sạch** (xem điểm #4) — lần test cuối bằng Playwright trên máy dev (IP đã heavy-test cả ngày) vẫn thấy 429/CORS + load ~23s, nhưng nghi do IP bị nhiễu, KHÔNG kết luận code sai. Cần user tự test lại bằng mạng/thiết bị sạch trước khi coi đây là đã fix xong.

**Việc còn pending liên quan RPC throttling:**
- Verify fix `fetchFn` bằng mạng sạch (xem điểm #4) — chưa có bằng chứng đáng tin cậy fix có thật sự giảm lỗi 429/CORS trong điều kiện bình thường hay không.
- Nếu sau khi verify sạch vẫn còn lỗi nhiều, cân nhắc thử tăng `minIntervalMs` (hiện 400ms) — nhưng PHẢI đo bằng mạng sạch trước, không đoán.

**How to apply:** Trước khi đổi bất kỳ giá trị nào trong `concurrency.ts` (`maxConcurrent`, `minIntervalMs`) hoặc thử lại batch JSON-RPC, đọc lại 4 điểm trên — đặc biệt điểm #1 (batch đã test và loại bỏ) và điểm #4 (benchmark trên IP nhiễm test cũ không đáng tin).

---

## Cập nhật (session sau — REVERT bill detail về cache riêng-theo-bill, filter server-side)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa `bill/[id].tsx` (1 file).

**QUAN TRỌNG — đảo ngược quyết định của chính session ngay phía trên** ("bill detail load chậm: cache dùng chung theo bill + regenerate seed"): section đó đã đổi `fetchContributions`/`fetchSharePayers` sang cache key CHUNG (`sabi-scan-SlotFilled`/`sabi-scan-SharePaid`, không filter server-side) — session NÀY revert lại về cache key RIÊNG theo `billId` + filter server-side qua `args`, theo yêu cầu bàn giao trực tiếp từ chủ dự án (ưu tiên an toàn trước deadline demo hackathon). Đọc phần này SAU cùng để biết trạng thái hiện tại — đừng tin nhầm section "cache dùng chung" ở trên còn hiệu lực.

**Lý do chủ dự án đưa ra trong bàn giao:** filter server-side (`args: { billId }`) giảm khối lượng log mỗi response, giảm rủi ro trước demo; đánh đổi mất khả năng chia sẻ cache giữa các bill được coi là chấp nhận được cho bối cảnh demo.

**Mình đã phản biện bằng bằng chứng TRƯỚC KHI implement (không làm mù theo bàn giao):**
- Đọc thẳng code `eventScan.ts` xác nhận: số CHUNK cần quét (`ranges.length`) tính từ `startCursor` tới `latestBlock` chia `CHUNK_SIZE` — **hoàn toàn không phụ thuộc `args`**. Filter server-side chỉ giảm kích thước MỖI response, không giảm SỐ REQUEST cần bắn — trái với tiền đề "filter giảm số log/chunk cần quét" trong bàn giao.
- Claim "trước đây (cache riêng) bill detail luôn load nhanh" mâu thuẫn với dữ liệu đã đo trong 2 session trước: lúc điều tra "bill detail load lâu", code CŨ (cache riêng, có filter) vẫn cần 4 chunk vì gap catch-up 38.952 block — và test bằng `git stash` xác nhận hiện tượng "stuck loading" xảy ra y hệt trên cả bản gốc (cache riêng).
- Với bối cảnh demo cụ thể (organizer mở NHIỀU bill khác nhau liên tiếp để show), cache riêng khiến MỖI bill mở lần đầu trong buổi demo đều có nguy cơ dính "stuck 20s" (nếu seed đã lùi từ lúc regenerate) — trong khi cache chung chỉ bill ĐẦU TIÊN trả giá đó, các bill sau + `/profile` dùng lại ngay.
- Đã trình bày rõ 3 điểm trên qua `AskUserQuestion`, đề xuất phương án "giữ cache chung + chỉ regenerate seed sát giờ demo" — **chủ dự án xác nhận vẫn muốn revert theo đúng bàn giao gốc**, có thể có thông tin/ưu tiên khác ngoài tầm quan sát của session (vd yêu cầu từ người khác trong team, hoặc ưu tiên tính dự đoán được của response size hơn tốc độ trung bình). Đã làm theo quyết định cuối của chủ dự án sau khi phản biện — không tự ý làm khác đi.

**Đã sửa:**
- `fetchContributions`: cache key đổi từ `sabi-scan-SlotFilled` (chung) sang `sabi-scan-SlotFilled-${billId}` (riêng), truyền `args: { billId }` vào `scanEventLogs` (trước đó `undefined`), bỏ `.filter((log) => log.args.billId === billId)` ở client (không cần nữa vì RPC đã filter đúng sẵn).
- `fetchSharePayers`: tương tự, cache key `sabi-scan-SharePaid-${billId}`.
- `eventScan.ts`: KHÔNG sửa gì — `matchesArgs(log, args)` đã generic sẵn từ trước, hoạt động đúng ngay với cache key mới.
- Giữ nguyên hoàn toàn (không đụng): `fetchFn` trong `wagmi.ts` (throttle transport-level), việc bỏ double-throttle ở `eventScan.ts`/`profile.tsx`, `useProfileData.ts`/`/profile` (không liên quan, vốn đã full-scan không filter từ trước, độc lập với thay đổi này).
- Cache cũ trong localStorage (`sabi-scan-SlotFilled`/`sabi-scan-SharePaid`, key CHUNG của session trước) giờ thành rác — không chủ động xoá, browser tự bỏ qua vì không còn đọc key đó nữa.

**Verify:** `npx tsc --noEmit` sạch. Dev server thật: `bill/1` render đúng (`.sabi-grid-detail` xuất hiện), không lỗi JS console. **CHƯA verify được tốc độ tải thật trên mạng sạch** — theo đúng nguyên tắc đã ghi ở mục "RPC throttling" phía trên (mục 4), benchmark trên IP máy dev (đã heavy-test cả ngày) không đáng tin, cần user tự verify bằng mạng/thiết bị sạch trước khi coi đây là đã xong.

**Việc còn pending:**
- Verify tốc độ tải thật bằng mạng sạch (ngrok+4G hoặc VPN) trước demo — cả cho fix `fetchFn` (mục "RPC throttling") lẫn revert này.
- Nếu sau demo muốn cân nhắc lại cache chung (đã verify nhanh hơn cho trường hợp mở nhiều bill liên tiếp), có thể tham khảo lại section "cache dùng chung theo bill" phía trên — code cache-chung không còn trong repo (đã revert), phải viết lại nếu cần.

**How to apply:** Đọc phần "cache dùng chung" phía trên CHỈ để hiểu lịch sử quyết định, KHÔNG áp dụng — trạng thái hiện tại của `bill/[id].tsx` là cache RIÊNG theo `billId` (section này). Nếu sau demo, đo được thật (mạng sạch) rằng cache riêng gây chậm rõ rệt khi user mở nhiều bill liên tiếp, đây là ứng viên hợp lý để cân nhắc quay lại cache chung — nhưng phải có số liệu thật, không suy đoán.

---

## Cập nhật (session sau — giới hạn trần retry/backoff + UI fallback cho bill detail cold-cache)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này sửa 5 file `frontend-rk/`.

**Bối cảnh:** Bàn giao mới phát hiện: mở 1 bill hoàn toàn mới (cold cache, đúng kịch bản người nhận link lần đầu — cũng là kịch bản khả năng cao nhất khi demo) mất tới 31 giây, dù đã có `fetchFn`/`withGlobalConcurrency` (chống burst) và đã revert cache riêng-theo-bill (giảm payload). Bàn giao chẩn đoán: `withRetry429` (5 lần/backoff x2, cộng dồn ~24.8s) là nguyên nhân, đề xuất giảm còn `retries=3`.

**Đã chỉnh 1 điểm quan trọng trong chẩn đoán TRƯỚC khi implement:** `getBill` (query quyết định "Loading bill info..." biến mất lúc nào — chính đường găng bàn giao nêu) **KHÔNG dùng `withRetry429`** — nó dùng `rpcRetryQueryOptions` trong `rpcRetry.ts`, một cơ chế retry HOÀN TOÀN RIÊNG (react-query's `retry`/`retryDelay`, cũng 5 lần nhưng công thức `Math.min(800 * 2**attemptIndex, 10000)`, cộng dồn ~22s). Nếu chỉ sửa `withRetry429` như bàn giao đề xuất, `getBill` vẫn treo ~22s vì đi qua đường hoàn toàn khác — đã sửa CẢ HAI để thật sự đạt mục tiêu.

**Đã sửa:**
1. `eventScan.ts` — `withRetry429`: `retries` mặc định 5 → 3 (giữ `delayMs=800`), tổng chờ tối đa từ ~24.8s xuống ~5.6s (800→1600→3200ms). Ảnh hưởng: `scanEventLogs` (fetchContributions/fetchSharePayers), `getBlockNumber`/`getTransaction` đơn lẻ dùng lại hàm này.
2. `rpcRetry.ts` — `rpcRetryQueryOptions`: `failureCount < 5` → `failureCount < 3`, cùng công thức delay (không đổi cap 10000ms vì với 3 lần không bao giờ chạm cap đó — 800/1600/3200 đều dưới 10000). Ảnh hưởng: MỌI `useReadContract`/`useReadContracts` dùng option này — `getBill`, `shareCount`, `getShare` multicall, `allowance`, `useBillsProgress`.
3. `bill/[id].tsx` — tách nhánh render `billError` (lỗi RPC/hết retry, có thể bill vẫn tồn tại thật) ra khỏi `!bill` (query thành công nhưng không có data). Trước đây gộp chung thành 1 thông báo "Bill not found" — khiến 1 lần RPC nghẽn/429 hết retry hiện NHẦM thành "bill không tồn tại" dù bill vẫn ở đó, và không có cách nào thử lại ngoài F5 cả trang. Giờ `billError` hiện `bill.load_error` ("Couldn't load bill info...") + nút `bill.retry` gọi `refetchBill()` (đã có sẵn từ `useReadContract`, không cần thêm state mới). `!bill` (không có `billError`) vẫn giữ nguyên thông báo `bill.not_found`/`bill.not_found_hint` cũ.
4. Thêm key `bill.load_error`/`bill.retry` vào `public/locales/{en,vi}/common.json`.

**Trade-off đã cân nhắc (theo đúng tinh thần bàn giao):** giảm số lần retry tăng khả năng fail hẳn thay vì chờ lâu rồi thành công — chấp nhận đánh đổi này cho demo vì UI giờ đã xử lý fail tốt (thông báo rõ + nút Retry) thay vì treo vô thời hạn không biết chuyện gì đang xảy ra.

**Verify:** `npx tsc --noEmit` sạch, JSON locale hợp lệ (`JSON.parse` cả 2 file EN/VI qua node). Dev server thật: `bill/1` render bình thường, không lỗi JS. `bill/999999` (test UI fallback) hiện ĐÚNG "Couldn't load bill info... Retry" thay vì treo — xác nhận cơ chế mới hoạt động thật, dù không chắc lần này là do bill thật sự chưa tồn tại hay do RPC đang nghẽn thật (IP máy dev vẫn nhiễm test cả ngày, xem mục "RPC throttling"). **CHƯA verify sạch** được phân biệt chính xác "not_found" (bill không tồn tại, lẽ ra fail nhanh không retry vì lỗi revert không phải lỗi rate-limit) vs "load_error" (RPC thật sự nghẽn) trong điều kiện mạng bình thường.

**Việc còn pending:**
- Verify bằng mạng sạch (ngrok+4G hoặc VPN) trước demo: đo lại đúng kịch bản gây vấn đề (bill hoàn toàn mới, cold cache) — mục tiêu tổng thời gian tệ nhất dưới ~10s hoặc fail nhanh với UI rõ ràng, không phải 31s như trước.
- Kiểm tra thật (mạng sạch) xem `bill/999999` (billId chắc chắn không tồn tại) có hiện đúng `not_found` (fail nhanh, không retry vì lỗi revert ≠ lỗi rate-limit) thay vì `load_error` hay không — hiện tại chưa phân biệt được 2 case này trong điều kiện IP nhiễm.
- Gộp chung với việc verify `fetchFn` (mục "RPC throttling") và revert cache riêng-theo-bill (mục ngay phía trên) — cả 3 thay đổi đều cần cùng 1 lần verify sạch, không cần làm riêng lẻ.

**How to apply:** Nếu sau này thấy 1 UI khác trong app cũng gộp chung "lỗi RPC" với "không có dữ liệu thật" thành 1 thông báo mù mờ (giống bug `bill.not_found` cũ ở đây), áp dụng đúng pattern đã sửa: tách riêng theo `error` object của query (không phải theo `!data`), hiện thông báo + nút gọi lại `refetch` có sẵn — không cần thêm state riêng, `useReadContract`/`useQuery` đã tự cung cấp `error`/`refetch`.

---

## Cập nhật (session sau — đổi kiến trúc đọc dữ liệu: RPC trực tiếp → Firestore đã index sẵn)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này là thay đổi KIẾN TRÚC lớn nhất từ trước tới giờ cho phần đọc dữ liệu hiển thị, nhưng chưa test tay đầy đủ mọi edge case (xem mục pending), nên chưa coi là "xong tuyệt đối", dù chủ dự án đã xác nhận "hoạt động tốt" sau khi fix xong lượt bug đầu tiên.

**QUAN TRỌNG — đọc mục này TRƯỚC khi áp dụng bất kỳ ghi chú nào về RPC throttling/retry/cache ở các section phía trên:** Toàn bộ lịch sử debug "RPC throttling trên Arc Testnet" (batch JSON-RPC, `concurrency.ts`, cache riêng/chung theo bill, retry cap 3 lần...) vẫn ĐÚNG về mặt kỹ thuật và code vẫn còn nguyên trong repo, nhưng **`bill/[id].tsx` và `useProfileData.ts` KHÔNG còn dùng những đường đó nữa** cho phần hiển thị bill/share/contribution/payment — 2 file này giờ đọc thẳng từ Firestore. `eventScan.ts`, `concurrency.ts`, `rpcRetry.ts`, `wagmi.ts`'s `arcThrottledFetch` **giữ nguyên, không xoá**, vẫn là fallback đã duyệt trước đó — nhưng đường chính (hot path) đã đổi hẳn.

**Lý do đổi (bàn giao trực tiếp từ chủ dự án, deadline nộp 9/8 vẫn còn nguyên):** Sau nhiều session tune retry/cache/throttle (xem toàn bộ lịch sử phía trên file này) vẫn còn tình trạng load chậm/429 vì RPC public `rpc.testnet.arc.network` rate-limit chặt và không kiểm soát được. Hướng mới: 1 script indexer chạy TAY (không cron) đọc on-chain rồi ghi sẵn vào Firestore, app chỉ đọc Firestore — bỏ hẳn phụ thuộc RPC-lúc-user-mở-trang cho phần hiển thị.

**Kiến trúc mới:**

1. **`frontend-rk/scripts/sync-firestore.mjs`** (mới, chạy bằng `npm run sync-firestore` trong `frontend-rk`) — dùng Firebase Admin SDK (không phải client SDK). Quét 3 event `BillCreated/SharePaid/SlotFilled` (tái dùng logic chunk 10.000 block + retry của `build-history-seed.mjs`, KHÔNG sửa file đó), bootstrap lần đầu từ `public/data/onchain-history-seed.json` có sẵn để đỡ quét lại từ block deploy, các lần sau chỉ quét tiếp từ checkpoint `_meta/sync.lastIndexedBlock` lưu trên chính Firestore (không phải file local — chạy từ máy nào cũng nối tiếp đúng). Với MỖI bill có log mới: gọi thêm `getBill()`/`shareCount()`/`getShare()` qua RPC (không chỉ decode event — event `BillCreated` KHÔNG có `amountPerSlot`/`numSlots`/`matchedSlotsCount`/`extraReceived`, và event `SharePaid` chỉ tồn tại cho share ĐÃ trả, không cho biết share nào còn chưa trả) rồi ghi đè `bills/{billId}` (merge, giữ nguyên `title`/`shareNames`/`slotNames` do client ghi trước đó). Dedupe log bằng `${transactionHash}:${logIndex}` — đúng key `dedupeLogs` trong `eventScan.ts` đã dùng, không phải cách mới.
2. **Schema Firestore mới** (`frontend-rk/src/lib/firebase.ts`, comment đầy đủ ở đầu file):
   - `bills/{billId}` mở rộng thêm: `organizer, mode, totalAmount, amountPerSlot, numSlots, matchedSlotsCount, extraReceived, txHash, blockNumber, contributions[], shares[]` (amount lưu dạng string vì Firestore không có BigInt).
   - `payments/{txHash}-{logIndex}` — collection MỚI, 1 doc/lượt trả (billId, shareId, payer, amount, matched, txHash, blockNumber) — tách riêng vì Firestore query kém trên field lồng trong array (`bills.contributions[].payer`), dùng để trang Profile tra "ví X đã trả những gì" bằng 1 query `where('payer','==',...)` thay vì quét toàn bộ event qua RPC.
   - `_meta/sync` — checkpoint `lastIndexedBlock` cho script.
3. **`bill/[id].tsx`** — bỏ hẳn `useReadContract`(getBill/shareCount)/`useReadContracts`(getShare multicall)/`scanEventLogs`(fetchContributions/fetchSharePayers). Dữ liệu bill giờ đọc qua `useBillSync` đã có sẵn (`onSnapshot` trên đúng doc `bills/{billId}`, tận dụng luôn subscription cũ vốn chỉ dùng cho title/shareNames/slotNames — KHÔNG thêm 1 lệnh `getDoc` riêng như bản đề xuất ban đầu trong bàn giao, vì cùng 1 doc rồi). **Optimistic overlay**: sau khi tx trả tiền (trực tiếp HOẶC cross-chain) confirm, ghi ngay 1 state local (`optimisticContributions`/`optimisticShares`) đè lên dữ liệu Firestore khi render — không đợi script sync chạy lại mới thấy cập nhật. `AssignedShares`/`ShareRow` bỏ toàn bộ multicall + cơ chế partial-failure-retry cũ (không còn cần vì không multicall nữa).
4. **`useProfileData.ts`** — `fetchProfileData` đổi sang gọi `fetchBillsByOrganizer`/`fetchPaymentsByPayer` (Firestore) thay vì quét 3 event qua RPC. `useBillsProgress` viết lại thành hàm derive thuần (`useMemo`, không RPC/Firestore nào) từ field đã có sẵn trong `CreatedBill` (thêm `numSlots/matchedSlotsCount/shareCount/paidShareCount` lúc map dữ liệu).
5. **`create.tsx`** — **gotcha tìm ra lúc chủ dự án test thật, đã fix:** ban đầu chỉ ghi `title`/`shareNames` lên Firestore ngay sau khi tạo bill (qua `saveBillTitle`/`saveBillShareNames`, đã có từ trước), KHÔNG ghi field on-chain (`organizer/mode/totalAmount/...`) — field đó chỉ có sau khi chạy `sync-firestore.mjs`. Hậu quả: tạo bill xong, `router.push('/bill/{id}')` ngay lập tức → trang hiện "bill not found" vì Firestore chưa có `totalAmount`. Đã fix bằng cách ghi optimistic ngay tại `create.tsx` (gọi `updateBillData` trực tiếp, cùng shape script sẽ ghi đè sau — `shares[]` toàn `paid:false` cho ASSIGNED, `contributions:[]` cho OPEN_SLOT), qua CLIENT SDK (rule `bills` vốn đã `allow write: if true` từ trước, không cần đổi rule).

**Bug/gotcha khác gặp khi user tự chạy thật lần đầu (đã fix hoặc đã hướng dẫn xong):**
- `firebase-admin` kéo theo `@google-cloud/firestore` nhưng npm KHÔNG tự cài `@opentelemetry/api` (dependency thật, không phải optional, của package đó) — script crash `MODULE_NOT_FOUND` lúc chạy lần đầu. Fix: thêm thẳng `@opentelemetry/api` vào `devDependencies`.
- Collection `payments` mới KHÔNG có Firestore Security Rule → Firestore mặc định deny-all cho collection chưa khai báo → `/profile` phần "Bills paid" luôn rỗng dù có dữ liệu thật (lỗi bị nuốt im lặng trong `fetchPaymentsByPayer`'s try/catch, không log ra UI). **Đây là thao tác CONSOLE, không phải code** — đã hướng dẫn chủ dự án tự thêm rule `match /payments/{paymentId} { allow read: if true; allow write: if false; }` qua Firebase Console → Firestore Database → Rules → Publish. Chủ dự án xác nhận đã thêm và hoạt động đúng.
- Chủ dự án yêu cầu xoá dữ liệu bill 35 và 36 khỏi Firestore (dọn dữ liệu test cũ, KHÔNG phải bug) — đã xoá `bills/35`, `bills/36` + 4 doc `payments` thuộc bill 36 (bill 35 không có payment) bằng 1 script tạm (Admin SDK, KHÔNG commit vào repo, đã xoá lại sau khi chạy xong). **Ghi chú cho session sau:** vì `sync-firestore.mjs` chỉ đụng tới bill có log MỚI trong lần quét (không quét lại toàn bộ mỗi lần), 2 bill này sẽ KHÔNG tự xuất hiện lại ở lần sync tiếp theo trừ khi (a) có hoạt động on-chain mới cho đúng billId đó, hoặc (b) bootstrap lại từ đầu (xoá doc `_meta/sync` trên Firestore rồi chạy lại script — lúc đó sẽ nạp lại toàn bộ từ seed JSON + quét full lại).

**Không đổi (out of scope, cố ý):** `eventScan.ts`, `concurrency.ts`, `wagmi.ts` (`arcThrottledFetch`) giữ nguyên làm fallback. `useLandingStats.ts` (trang `/`, thống kê tổng) vẫn quét RPC như cũ — KHÔNG nằm trong bàn giao lần này. `profile.tsx`'s `PaymentRow` vẫn tự gọi `publicClient.getTransaction(txHash)` qua RPC cho từng dòng payment (đã bọc `withRetry429`+`withGlobalConcurrency` từ session trước) — chỉ để lấy thêm chi tiết hiển thị, KHÔNG phải nguồn dữ liệu chính, không đổi trong session này.

**Đã verify:** `npx tsc --noEmit` sạch, `npm run build` sạch. Script `sync-firestore.mjs` chạy thật với credentials thật của chủ dự án — báo lỗi env var đúng lúc thiếu, chạy thành công sau khi đủ credentials (chủ dự án tự lấy service account key từ Firebase Console, KHÔNG commit file JSON đó — chỉ copy `client_email`/`private_key` vào `FIREBASE_ADMIN_CLIENT_EMAIL`/`FIREBASE_ADMIN_PRIVATE_KEY` trong `.env.local`, đã gitignore từ trước). Chủ dự án xác nhận trực tiếp: `/profile` hiện đúng "Bills created" VÀ "Bills paid", tạo bill mới không còn "bill not found".

**CHƯA verify (pending, chưa test tay):**
- Optimistic overlay khi trả tiền qua đường cross-chain (burn → attest → relay) với kiến trúc mới — luồng trả trực tiếp trên Arc đã chủ dự án xác nhận hoạt động, cross-chain thì chưa có xác nhận riêng.
- Trường hợp 2 người trả cùng lúc 1 bill (race condition giữa optimistic overlay local của người A và dữ liệu Firestore vừa được người B trả cập nhật) — chưa test.
- README.md gốc repo (`Data sync` trong bảng tech stack, mục "Getting started"/"Required environment variables") **CHƯA cập nhật** để phản ánh kiến trúc mới — vẫn mô tả Firestore chỉ dùng cho "bill titles, profile names", không nhắc `FIREBASE_ADMIN_*`/script `sync-firestore.mjs`/collection `payments`. Chưa sửa vì không nằm trong yêu cầu của session này — cần session sau cập nhật nếu chủ dự án muốn README khớp thực tế trước khi nộp bài/để người khác đọc.
- Chưa re-run `build-history-seed.mjs` trong session này (không cần thiết cho kiến trúc mới trừ khi muốn bootstrap `sync-firestore.mjs` nhanh hơn lần đầu ở máy khác — file seed cũ vẫn dùng được, chỉ là cũ hơn theo thời gian như mọi lần trước).

**Việc cần làm trước mỗi lần demo (thao tác vận hành, không phải code):** chạy `npm run sync-firestore` (trong `frontend-rk`) để đồng bộ dữ liệu payment mới nhất lên Firestore trước khi cho người khác xem — service account key + `.env.local` đã sẵn sàng ở máy chủ dự án, chỉ cần chạy lệnh.

**How to apply:** Nếu sau này thêm 1 trang/tính năng MỚI cần hiển thị dữ liệu on-chain (bill/share/payment), đọc từ Firestore theo đúng schema ở mục 2 phía trên — KHÔNG tự thêm `useReadContract`/`scanEventLogs` mới trừ khi có lý do cụ thể (vd cần dữ liệu real-time hơn mức Firestore+script-chạy-tay cho phép). Nếu Firestore trả về mảng rỗng bất thường dù có dữ liệu thật, **luôn kiểm tra Security Rules trước** (console warning `[Firebase] fetch...failed` bị nuốt im lặng trong try/catch, dễ nhầm là "không có dữ liệu" thay vì "bị chặn quyền") — đúng bug đã gặp với collection `payments` ở session này.
