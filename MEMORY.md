# MEMORY.md — Sabi project state

Sabi là Split Bill dApp trên Arc Testnet dùng USDC + CCTP V2 (Fast Transfer). Portfolio project, test thật với nhóm bạn builder trên Arc Testnet — testnet only, không mainnet. Nộp Arc Architects Program hạn 9/8.

## Cập nhật mới nhất (giới hạn trần retry/backoff + UI fallback cho bill detail cold-cache)

Bàn giao phát hiện: mở 1 bill hoàn toàn mới (cold cache, kịch bản demo khả năng cao nhất) mất tới 31s dù đã có `fetchFn`/throttle và revert cache riêng-theo-bill. Chẩn đoán gốc trong bàn giao đề xuất sửa `withRetry429` (5 lần/backoff x2, ~24.8s) — **đã chỉnh 1 điểm trước khi implement:** `getBill` (query quyết định "Loading bill info..." biến mất lúc nào) **không dùng `withRetry429`**, nó dùng `rpcRetryQueryOptions` trong `rpcRetry.ts` — cơ chế RIÊNG (react-query retry, cũng ~22s). Sửa cả 2 mới thật sự đạt mục tiêu.

**Đã sửa:**
1. `eventScan.ts` — `withRetry429`: `retries` 5 → 3, tổng chờ tối đa ~24.8s → ~5.6s.
2. `rpcRetry.ts` — `rpcRetryQueryOptions`: `failureCount < 5` → `failureCount < 3`, cùng lý do — ảnh hưởng `getBill`, `shareCount`, `getShare` multicall, `allowance`, `useBillsProgress`.
3. `bill/[id].tsx` — tách nhánh `billError` (lỗi RPC/hết retry) khỏi `!bill` (không có data thật) — trước đây gộp chung thành "Bill not found", khiến 1 lần 429 hết retry hiện NHẦM thành "bill không tồn tại". Giờ `billError` hiện `bill.load_error` + nút `bill.retry` gọi `refetchBill()` có sẵn.
4. Thêm key `bill.load_error`/`bill.retry` cho EN/VI.

**Trade-off:** giảm retry tăng khả năng fail hẳn thay vì chờ lâu rồi thành công — chấp nhận vì UI giờ xử lý fail tốt (thông báo + nút Retry) thay vì treo vô thời hạn.

**Verify:** typecheck sạch, JSON locale hợp lệ. `bill/999999` hiện đúng UI fallback mới (không treo) — xác nhận cơ chế hoạt động, nhưng chưa chắc lần này là do bill thật sự không tồn tại hay do IP máy dev vẫn nhiễm rate-limit từ test cả ngày. **Chưa verify sạch** được phân biệt chính xác `not_found` vs `load_error` trong điều kiện mạng bình thường.

**Việc còn pending:** verify bằng mạng sạch (ngrok+4G/VPN) trước demo — gộp chung với việc verify `fetchFn` và revert cache riêng-theo-bill (3 thay đổi liên quan đều cần cùng 1 lần verify sạch). Mục tiêu: cold-cache load dưới ~10s hoặc fail nhanh rõ ràng, không phải 31s như trước.

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (REVERT bill detail về cache riêng-theo-bill, filter server-side)

**QUAN TRỌNG — đảo ngược quyết định của mục ngay phía dưới** ("bill detail load chậm: cache dùng chung theo bill + regenerate seed"): mục đó đổi `bill/[id].tsx` sang cache CHUNG cho mọi bill — mục NÀY revert lại về cache RIÊNG theo `billId` + filter server-side, theo yêu cầu bàn giao trực tiếp từ chủ dự án (ưu tiên an toàn trước deadline demo hackathon). **Trạng thái hiện tại (đọc mục này, không phải mục "cache dùng chung" phía dưới):** `fetchContributions`/`fetchSharePayers` dùng cache key `sabi-scan-SlotFilled-${billId}`/`sabi-scan-SharePaid-${billId}`, truyền `args: { billId }` vào `scanEventLogs` để filter server-side, KHÔNG còn filter client-side.

**Đã phản biện bằng bằng chứng trước khi implement** (không làm mù theo bàn giao): số CHUNK cần quét phụ thuộc block range, KHÔNG phụ thuộc filter (đọc code `eventScan.ts` xác nhận) — nên "filter giảm số chunk" trong lý do bàn giao không đúng, filter chỉ giảm KÍCH THƯỚC mỗi response. Dữ liệu đo trước đó cũng mâu thuẫn với "cache riêng trước đây luôn nhanh" (code cũ vẫn cần 4 chunk khi gap catch-up lớn, test `git stash` xác nhận "stuck loading" xảy ra y hệt trên bản cache riêng). Đã trình bày rõ qua `AskUserQuestion`, đề xuất giữ cache chung + chỉ regenerate seed sát giờ demo — **chủ dự án xác nhận vẫn muốn revert theo đúng bàn giao gốc** (có thể có ưu tiên/thông tin khác ngoài tầm quan sát), đã làm theo sau khi phản biện.

**Đã sửa:** `bill/[id].tsx` — đổi cache key + truyền `args: { billId }` cho cả `fetchContributions` (SlotFilled) và `fetchSharePayers` (SharePaid), bỏ `.filter()` client-side. `eventScan.ts` không cần sửa (`matchesArgs` đã generic sẵn). Giữ nguyên hoàn toàn: `fetchFn` throttle trong `wagmi.ts`, việc bỏ double-throttle, `useProfileData.ts`/`/profile` (không liên quan).

**Verify:** typecheck sạch, dev server render `bill/1` đúng, không lỗi JS. **CHƯA verify tốc độ thật trên mạng sạch** (IP máy dev đã heavy-test cả ngày, benchmark không đáng tin — xem mục RPC throttling phía dưới).

**Việc còn pending:** verify tốc độ tải thật bằng mạng sạch trước demo (ngrok+4G hoặc VPN) — áp dụng cho cả revert này lẫn fix `fetchFn`. Nếu sau demo đo được cache riêng gây chậm rõ rệt khi mở nhiều bill liên tiếp, cân nhắc quay lại cache chung (code đã revert khỏi repo, phải viết lại nếu cần).

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (đồng bộ màu nút toàn app, fix Approve/Pay lẫn lộn, bill detail load chậm)

**1. Đồng bộ màu nút:** `theme.ts` — `colors.buttonPrimary` đổi từ đen (`#17151F`) sang tím (`#998EFF`, đúng CTA landing), `buttonPrimaryHover` sang `#877DE0`. Token trung tâm nên cascade tự động khắp app. Nút "Share bill" (`bill/[id].tsx`) đổi từ gradient riêng (`colors.primary`/`primaryHover`) sang dùng thẳng `colors.buttonPrimary` (phẳng, khớp mọi nút khác).

**2. Fix "Approve USDC"/"Pay" hiện lẫn lộn trong 1 bill:** root cause — mỗi `ShareRow` so `allowance` (1 giá trị DUY NHẤT/ví theo chuẩn ERC20) với `share.amount` RIÊNG của hàng đó, nên share nhỏ hiện "Pay" trong khi share lớn hơn cùng lúc hiện "Approve" dù cùng 1 allowance thật. Fix: đổi threshold so sánh + amount approve sang `bill.totalAmount` (thread qua prop `totalAmount` từ `AssignedShares` → `ShareRow`) — approve 1 lần đủ cho cả bill, mọi hàng luôn đồng nhất trạng thái. Chỉ sửa mode ASSIGNED, không đụng OPEN_SLOT (vốn đã dùng chung 1 `amountPerSlot`, không có bug tương tự).

**3. Bill detail load chậm — root cause khác `/profile`:** `fetchContributions`/`fetchSharePayers` dùng cache key RIÊNG theo từng `billId` (lọc server-side được vì `billId` indexed) — hệ quả mỗi bill khác nhau phải tự quét catch-up lại từ đầu, không chia sẻ cache dù cùng block range. Gap catch-up đo được lúc điều tra: 38.952 block (sát ngưỡng `MAX_CHUNKS=4`). Fix: đổi sang cache key CHUNG (`sabi-scan-SlotFilled`/`sabi-scan-SharePaid`, khớp `profile.tsx`), quét không lọc rồi filter `billId` ở client; bọc `getBlockNumber()` bằng `withRetry429`; regenerate seed (`cutoffBlock` 55.089.050 → 55.129.557). Verify thật: bill #1 nguội cần 4 chunk/7.5s, bill #2 sau đó chỉ cần 1 chunk/319ms (dùng lại cache bill #1) — xác nhận cơ chế share cache đúng thiết kế.

Phát hiện bill detail "stuck ở Loading" lúc test mục 2 → dùng `git stash` xác nhận KHÔNG phải regression (bản gốc cũng bị y hệt) → khởi đầu điều tra RPC throttling ở mục dưới.

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (RPC throttling Arc Testnet — kiến thức tích luỹ, tiếp nối session /profile cùng ngày)

Sau fix `/profile`, chủ dự án báo cả `/profile` lẫn bill detail đều load chậm bất thường (~20s, đôi khi treo hẳn). Điều tra bằng DevTools Network/Console + đọc source thật, rút ra:

1. **Batch JSON-RPC phản tác dụng trên `rpc.testnet.arc.network`, đã test và LOẠI BỎ:** 6 lệnh rời rạc → 0 lỗi. Bật `batch: true` → RPC trả `"request limit reached"` cho 3/6 lệnh. `batch: { wait: 20 }` → 6/6 lỗi. RPC này đếm giới hạn theo số lệnh logic trong batch, chặt hơn hẳn gửi rời rạc — **không dùng `batch` cho transport Arc**.
2. **429 không kèm CORS header → browser hiện nhầm thành "CORS error"** — thấy lỗi CORS hàng loạt trên RPC này thì mặc định hiểu là rate-limit, không phải lỗi cấu hình CORS thật.
3. **`RateLimiter(maxConcurrent, minIntervalMs)` trong `concurrency.ts` đã là rate-limit theo thời gian thực sự** (không phải thuần concurrency) — `minIntervalMs` ép khoảng cách giữa các lần dispatch. Đang set `RateLimiter(2, 400)` ≈ trần 2.5 req/giây. Không đổi sang token bucket trừ khi mục tiêu là đổi shape traffic (cho burst) — token bucket lỏng hơn, dễ làm tệ hơn nếu mục tiêu là giảm rate.
4. **RPC public có thể giữ trạng thái rate-limit riêng theo IP, tích luỹ sau nhiều giờ test dồn dập.** Benchmark trên IP đã heavy-test cả ngày KHÔNG đáng tin để đánh giá 1 fix — dễ nhầm "code vẫn lỗi" trong khi là do IP bị RPC-side throttle từ lịch sử test cũ. Cần verify bằng mạng/IP sạch (ngrok + 4G, VPN, hoặc đợi rate-limit hạ nhiệt) trước khi kết luận.
5. **Fix đã áp dụng:** custom `fetchFn` cho transport Arc trong `wagmi.ts`, route qua `withGlobalConcurrency` sẵn có — bắt được mọi request vật lý (kể cả `useReadContract`/`useReadContracts` của wagmi, không chỉ `eventScan.ts` như trước). Bỏ lớp `withGlobalConcurrency` dư thừa ở `eventScan.ts`/`profile.tsx` (double-throttle cũ). Đã confirm `fetchFn` thật sự được gọi (11 lần/5s khi mở 1 bill). **CHƯA verify hiệu quả bằng mạng sạch** — test cuối trên IP đã nhiễm vẫn thấy 429/CORS, nghi do điểm #4, không kết luận code sai.

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session tăng độ ổn định `/profile`: retry getBlockNumber + gộp getTransaction vào rate-limiter chung)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa 3 file `frontend-rk/`, không chạy lại test Solidity/Foundry.

Chủ dự án báo `/profile` thỉnh thoảng hiện banner "Couldn't load on-chain history (RPC error or overloaded)" + cảm giác load chậm, muốn trị dứt điểm. Điều tra bằng đọc code + gọi RPC thật (không đoán):

1. **Seed file không phải nguyên nhân:** gap catch-up hiện chỉ ~16.569 block (2 chunk), RPC test trực tiếp bằng `getContractEvents` cho đúng range cần quét trả về nhanh (<1.3s), 0 lỗi — RPC khoẻ tại thời điểm test, lỗi chủ dự án gặp là gián đoạn không liên tục, không phải hỏng vĩnh viễn.
2. **Đọc source viem** (`buildRequest.js`) xác nhận: transport `http()` mặc định ĐÃ tự retry 3 lần (~150-600ms) cho cả 429 lẫn lỗi mất mạng thoáng qua (`status undefined`) — mọi lệnh RPC trong app đều có sẵn ~1s đệm miễn phí từ viem. Lớp `withRetry429` custom của app (5 lần, backoff tới ~25s) là phòng thủ THỨ HAI — chỉ lệnh nào KHÔNG được bọc lớp này mới thực sự mong manh (chỉ ~1s đệm).
3. **2 lệnh RPC mong manh tìm được trong luồng `/profile`:** `useProfileData.ts`'s `fetchProfileData()` gọi `getBlockNumber()` trần không có lớp retry thứ 2 (khác `useLandingStats.ts` đã có `getBlockNumberWithRetry` riêng cho đúng việc này) — 1 blip đúng lúc gọi lệnh ĐẦU là toàn bộ query throw, khớp đúng banner lỗi. `profile.tsx`'s `PaymentRow` mỗi dòng tự gọi `getTransaction()` riêng, KHÔNG qua `withGlobalConcurrency` (rate-limiter chung 2 request/400ms) — list dài càng nhiều request bắn đồng thời không điều phối cùng phần quét log khác.
4. **Đã thử + LOẠI BỎ hướng JSON-RPC batching** (tưởng gộp nhiều lệnh nhỏ thành 1 HTTP request sẽ giúp): RPC Arc Testnet CÓ hỗ trợ batch (verify bằng `curl`), nhưng test thật bằng script viem với đúng 6 lệnh giống `/profile` cho kết quả NGƯỢC: không batch → 6 request, 0 lỗi; bật `batch:true` → 1 request nhưng RPC trả `"request limit reached"` cho 3/6 lệnh; `batch:{wait:20}` → 6/6 lỗi. RPC này đếm giới hạn theo số lệnh logic trong batch chặt hơn hẳn so với gửi rời rạc — **batching phản tác dụng cho RPC này, đã loại bỏ, không dùng, không thử lại hướng này sau này**.

**Đã sửa (không đổi hành vi UI, chỉ tăng độ chịu lỗi RPC):** export `withRetry429` từ `eventScan.ts` (tái dùng thay vì viết thêm bản sao thứ 3); bọc `getBlockNumber()` trong `useProfileData.ts` bằng `withRetry429`; bọc `getTransaction()` trong `PaymentRow` (`profile.tsx`) bằng cả `withGlobalConcurrency` + `withRetry429`.

**Đánh đổi đã báo:** `getTransaction` giờ xếp hàng qua rate-limiter chung thay vì bắn tự do — có thể chậm hơn chút ở trường hợp không lỗi, đổi lại ít khả năng chạm rate-limit hơn. Nhất quán với quyết định cũ ở `concurrency.ts` (ưu tiên ổn định hơn tốc độ thô).

**Giới hạn thật, không trị dứt điểm 100% được:** RPC public testnet có thể nghẽn lâu hơn cả tổng retry app-level (~25s) trong trường hợp xấu nhất — banner + nút Retry vẫn là lớp chống cuối, chỉ giảm tần suất, đã nói rõ với chủ dự án.

**Verify:** `npx tsc --noEmit` sạch; `curl http://localhost:3000/profile` → 200, đúng trạng thái chưa connect ví (chưa test được trạng thái đã connect vì môi trường không có ví thật).

**Ghi nhận phụ:** `bill.allow_sabi_usdc` bản EN được chủ dự án tự sửa tay ("Allow" → "Approve Sabi to use USDC"), không liên quan session này.

Chi tiết: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session sửa nội dung Process sang luồng tạo bill, đồng nhất icon, bỏ caption Use Case, chỉnh spacing)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ sửa `frontend-rk/src/pages/index.tsx` + 2 file locale, không chạy lại test Solidity/Foundry.

Handoff mới (`sabi-landing-v2-demo.html` + note trong chat) yêu cầu 4 việc:

1. **Nội dung Process đổi từ luồng thanh toán sang luồng TẠO bill:** 4 bước cũ mô tả góc nhìn người TRẢ tiền (chọn chain giữ USDC / ASSIGNED·OPEN_SLOT / ký giao dịch / CCTP 20s), giờ đổi sang góc nhìn người TẠO bill: Connect wallet → Create a bill (Open Slot chia đều/Assigned gán số tiền) → Share the link → Check the bill. **Bỏ hẳn 4 chip phụ** dưới mỗi bước (Base·Arbitrum·Ethereum, ASSIGNED·OPEN_SLOT, 1 signature·no swap, ~20 seconds) — chủ dự án yêu cầu rõ "không đều nhau về nội dung nên bỏ, không cần khôi phục". Card footer đổi thành "Every bill lives at **one link** — Sabi handles the cross-chain settlement via Circle CCTP V2." (VI tương ứng).
2. **Đồng nhất màu icon cả 4 bước:** trước đó bước 4 có override riêng (icon/số thứ tự nền trắng, packet animation kết thúc màu trắng) không khớp 3 bước đầu (tông tím nhạt). Đã xoá hết override `.step:last-child *`, sửa `@keyframes travel` mốc 100% từ trắng sang tím (`${c.accent}`) — 4 bước giờ dùng chung 1 style.
3. **Use Case — bỏ dòng caption cuối** "Arc Testnet · settles in ~20 seconds" (JSX + CSS class `.usecases-caption` + key locale, xoá cả 3 vì đây là orphan do chính thay đổi này).
4. **Chỉnh spacing:** `.usecases` bottom-padding đổi từ 80px xuống 28px để khoảng cách Use Case→Process bằng khoảng cách Process→Stats (56px cả hai, đúng số liệu demo `sabi-landing-v2-demo.html`).

**Verify (Playwright, cài tạm scratchpad):** đo `getBoundingClientRect()` xác nhận cả 2 khoảng cách đều 56px (EN + VI); screenshot full-page xác nhận Process không còn chip, 4 icon đồng nhất tím, heading VI Process vẫn đúng 1 dòng (fix session trước không bị ảnh hưởng); `npx tsc --noEmit` sạch. Phần Stats hiện trắng trong screenshot full-page là do `IntersectionObserver` reveal-on-scroll chưa kịp fire lúc chụp — hành vi có sẵn từ trước, không phải regression, ngoài scope session này.

File đổi: `frontend-rk/src/pages/index.tsx` (`ProcessSection` + `.usecases`), `frontend-rk/public/locales/{en,vi}/common.json` (nội dung `process_step*`/`process_foot*` mới, xoá key `process_step*_chip` + `usecase_caption`).

Việc còn pending (không đổi): dán link Feedback Google Form thật; test tay điện thoại thật cho Share bill; theo dõi RPC "Failed to fetch" có tái diễn không. Lỗi gõ VI ở `process_step4_desc` đã được chủ dự án tự sửa — không còn pending.

Chi tiết: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session fix heading Process bị wrap ở bản VI)

`text-wrap: balance` (thêm session trước) chỉ chia đều dòng khi BẮT BUỘC wrap, không giúp fit vừa 1 dòng. Heading Process bản VI vẫn xuống 2 dòng vì `.card-head` có `max-width: 560px` cứng (đủ cho bản Anh ngắn hơn). Fix: bỏ max-width khỏi `.card-head`, chuyển `max-width: 620px` sang riêng `.card-head p` (subtitle). Verify bằng Playwright đo `boundingBox`: height 40.5px (1 dòng) cho cả EN/VI.

**Phát hiện phụ, chưa sửa:** `landing.process_step4_desc` bản VI trong `common.json` bị lỗi gõ tay (thiếu dấu cách "kháclên", thừa khoảng trắng cuối câu) — đây là nội dung chủ dự án tự sửa ngoài phiên làm việc, đã báo lại, chưa tự sửa.

Chi tiết: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session xây lại landing page v2 — nav, i18n thật, Process/Stats/FAQ)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ đụng `frontend-rk/`, không chạy lại test Solidity/Foundry.

**Bối cảnh:** Landing cũ (`frontend-rk/src/pages/index.tsx`) chỉ có Hero + 3 Use Case, không nav, không i18n, không Process/Stats/FAQ. Handoff mới (demo `sabi-landing-v2-demo.html`) yêu cầu thêm toàn bộ. Đã hỏi lại chủ dự án 3 quyết định trước khi code, đều chọn phương án đầy đủ (không rút gọn scope):

1. **Nav mới:** Faucet (link thẳng `https://faucet.circle.com/`, đơn giản hơn hẳn dropdown `FaucetMenu` dùng ở các trang app khác — cố ý khác vì đây là trang marketing nhẹ). Feedback: **chưa có link Google Form thật** — đang để placeholder `href="#"` kèm comment TODO trong `index.tsx`, chờ chủ dự án tạo form rồi dán vào. Dropdown ngôn ngữ: export thêm `LocaleSwitcher` từ `SabiHeader.tsx` (trước đó private) để landing tái dùng đúng 1 cơ chế đổi locale, không viết lại.
2. **i18n EN/VI thật:** thêm `getServerSideProps`/`serverSideTranslations` + namespace `landing.*` mới trong `common.json` (~50 key) cho toàn bộ nav/hero/use case/process/stats/faq. Hero + Use Case giữ nguyên MÀU đã duyệt trước đó, chỉ đổi string.
3. **Stats nối data thật:** 2 tile "Bills created" + "USDC settled" đọc thật qua hook mới `frontend-rk/src/hooks/useLandingStats.ts` (quét TOÀN BỘ lịch sử on-chain, không lọc theo ví, tái dùng `scanEventLogs` có sẵn, cacheKey riêng `sabi-scan-*-landing`). "Source chains" (3) và "Avg settlement" (~20s) là thông tin sản phẩm cố định, không phải số đọc chain. Xác nhận qua browser: 47 bills, 296 USDC settled (3/8/2026).

**Process + Stats là 2 section HOÀN TOÀN MỚI** (không có trước đây) — Process: card nền đen, 4 bước, track/packet CSS keyframes thuần. Stats: card tím gradient, 4 tile, reveal-on-scroll + count-up bằng `IntersectionObserver`/`requestAnimationFrame` thuần trong React, không thêm dependency.

**Bug tìm + fix lúc build Stats (verify bằng curl thật):** `useLandingStats` gặp lỗi "Failed to fetch" (CORS-looking, RPC public quá tải nhất thời — verify bằng `curl OPTIONS` giả lập preflight nhiều lần thấy có lúc pass có lúc fail, KHÔNG phải RPC down/lỗi cấu hình vĩnh viễn). Đã thêm retry riêng cho lần gọi `getBlockNumber()` đầu trong hook MỚI này (khác quyết định trước là không đụng các chỗ cũ tương tự trong `bill/[id].tsx`, đã xác nhận chỉ lỗi 1 lần). Landing quét GLOBAL nên catch-up nặng hơn — đã chạy lại `node scripts/build-history-seed.mjs`, đẩy `cutoffBlock` từ 54580493 (31/7) lên 55089050 (3/8), giảm gap catch-up gần về 0.

**Fix nhỏ:** bản dịch VI của heading "Process" dài hơn bản Anh, wrap để lại từ "xong" mồ côi 1 dòng — fix bằng `text-wrap: balance` (CSS thuần), áp dụng cho MỌI heading tương tự trong trang (hero/usecase/process/stats/faq), không chỉ chỗ bị báo.

**FAQ đã đổi nội dung 2 lần trong session, bản CUỐI CÙNG (4 câu, câu 1 mở mặc định):** What is Sabi? → Why do you need Sabi instead of a bank transfer or sending crypto directly? → What's the difference between ASSIGNED and OPEN_SLOT? → How is Sabi different from a typical bridge? (bản đầu có "What is CCTP"/"Which chains"/"gas fees" đã bị thay hết, xem thẳng `common.json` để chắc, đừng tin bản cũ).

**Gotcha xác nhận lại:** next-i18next cache locale JSON phía server rất dai — sau khi sửa `common.json`, kill port 3000 chưa chắc đủ nếu còn tiến trình `node.exe` con sống sót. Luôn `tasklist /FI "IMAGENAME eq node.exe"` + kill hết trước khi tin đã restart sạch.

File đổi: `frontend-rk/src/pages/index.tsx` (viết lại gần như toàn bộ), `frontend-rk/src/hooks/useLandingStats.ts` (mới), `frontend-rk/src/components/SabiHeader.tsx` (export `LocaleSwitcher`), `frontend-rk/public/locales/{en,vi}/common.json`, `frontend-rk/public/data/onchain-history-seed.json` (regenerate).

**Việc còn pending:** dán link Feedback Google Form thật khi có (TODO trong `index.tsx`); seed file sẽ lùi dần theo thời gian, không bắt buộc re-run định kỳ nhưng nên chạy lại trước các mốc quan trọng.

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session thêm tính năng Share bill + điều tra 1 lần RPC blip)

**Vẫn KHÔNG tự gán "hoàn thành" cho phase nào** — session này chỉ đụng `frontend-rk/`, không chạy lại test Solidity/Foundry.

**1. Tính năng "Chia sẻ bill" ở trang chi tiết bill — đã xây xong, đã verify bằng Playwright (cài tạm, không phải dependency của repo):**

- File mới `frontend-rk/src/components/ShareBillSheet.tsx` (bottom sheet chia sẻ) + nút "Share bill" gradient tím dưới `ReceiptCard` trong `bill/[id].tsx` (bọc chung 1 `<div>` để không phá CSS đảo panel mobile) + namespace `share_*` mới trong `public/locales/{en,vi}/common.json`.
- `shareText` lấy tên người tạo bill thật (organizer address → tra `profileName` Firestore, tái dùng `useProfilesSync` có sẵn).
- **2 biến thể tuỳ thiết bị** (chốt sau nhiều vòng hỏi lại với chủ dự án):
  - Desktop: chỉ 3 nút — Telegram, Mail, + 1 nút "Copy link" chung.
  - Mobile fallback (trình duyệt mobile không hỗ trợ `navigator.share()`): đầy đủ 7 nút — Telegram, WhatsApp, Discord, X, Messenger, Zalo, Mail (Discord/X/Messenger/Zalo copy-link vì không có URL scheme public để pre-fill).
  - `isMobile` xác định bằng regex `userAgent`, KHÔNG dùng `navigator.share` tồn tại hay không (lý do ngay dưới).
- **`navigator.share()` (native OS share) CHỈ gọi khi `isMobile === true`:** trước đó chỉ check API tồn tại, nhưng Windows Edge/Chrome cũng có Web Share API — gọi trên desktop bật share dialog CỦA WINDOWS (Facebook/LinkedIn/Outlook/app lạ, không kiểm soát được). Chủ dự án xác nhận qua ảnh chụp thật, chốt: desktop luôn dùng sheet tự vẽ.
- **Giới hạn nền tảng đã giải thích rõ, không cố khắc phục (không có API public):** X không có link mở thẳng DM kèm text (chỉ có intent "soạn tweet công khai") → copy-link. Discord không có URL scheme mở picker chọn kênh từ web (Procreate làm được vì là app native gọi thẳng share sheet HĐH có Share Extension riêng của Discord — web không chạm được share sheet đó trừ khi cũng gọi `navigator.share()`, nhưng vậy lại kéo theo toàn bộ app hệ thống). Telegram không auto-link `http://localhost` (thiếu domain/TLD thật) — sẽ tự hết khi deploy domain thật, không phải bug.
- **Verify:** Playwright cài tạm trong scratchpad (không thêm vào `package.json`), chụp screenshot xác nhận cả 2 biến thể đúng thứ tự/nội dung, toast đúng, link Telegram build đúng `encodeURIComponent` + tên thật. **Chưa test bằng điện thoại thật** (chỉ giả lập UA Playwright) — hành vi `navigator.share()` thật trên Android/iOS chưa verify bằng máy thật.

**2. Điều tra RPC "Failed to fetch" ở bill detail — CHỈ điều tra, KHÔNG sửa code:**

- Chủ dự án báo Next.js dev overlay hiện `HttpRequestError` cho `eth_blockNumber`, badge "1 Issue" — trang vẫn render bình thường (không crash), vì `fetchSharePayers` đã có try/catch, chỉ `console.error` (Next.js dev tự vợt console.error vào Issues, không phải crash thật). Hàm này không retry ở lần gọi đầu lúc mount.
- Chủ dự án xác nhận: **chỉ 1 lần, F5 là hết** → kết luận RPC public nghẽn thoáng qua, không sửa code. Nếu tái diễn thường xuyên, cần thêm retry cho lần gọi đầu ở `fetchSharePayers`/`fetchContributions`.

**Việc còn pending:** test tay bằng điện thoại thật cho share sheet; theo dõi xem lỗi RPC blip có tái diễn không.

Chi tiết đầy đủ: xem `memory/project_sabi_phase1.md`.

## Cập nhật trước đó (session dọn repo + verify contract + fix bug "profile không hiện bill")

**Đã commit + push lên `origin/main`:**

- `0a0fa23` — README.md thật cho Sabi (thay boilerplate Foundry mặc định).
- `31380b0` — xoá dead code Phase 1 (`src/BillHookReceiver.sol` + test liên quan + `script/DeployBillHookReceiver.s.sol`, không còn dùng vì `src/bill.sol` tự gọi `receiveMessage()`/decode `BurnMessageV2`) + boilerplate Foundry (`src/Counter.sol`, `test/Counter.t.sol`, `script/Counter.s.sol`). `forge build`/`forge test` 20/20 pass.
- `f3adbaa` — fix nhỏ tốc độ `/profile` lần 1: `PaymentRow` đổi từ `useEffect`/`useState` sang `useQuery` (`staleTime: Infinity`) để không gọi lại `getTransaction()` mỗi lần mount cùng `txHash`.
- **Không đụng:** `script/DeploySabiBill.s.sol`, `broadcast/*.json` (log deploy thật), contract address, TODO cố ý ở `SabiHeader.tsx`/`transaction-status.ts`.

**Đã làm, không tạo file thay đổi:** `forge verify-contract` cho `0x192963eBcC9f39C0057597CF3AA7d97c99a83c75` lên Blockscout Arc Testnet — submit thành công (GUID `192963ebcc9f39c0057597cf3aa7d97c99a83c756a6ab7c5`), **chưa xác nhận trạng thái "Verified" cuối trên explorer**.

**Bug thật đã tìm ra + fix gốc (không phải "chậm", mà là MẤT DỮ LIỆU vĩnh viễn trong UI):**

`eventScan.ts` lần quét đầu (chưa cache) chỉ quét lùi 40.000 block gần nhất rồi lưu cache coi như "đã quét xong toàn bộ" — bill nào tạo xa hơn cửa sổ đó bị mất vĩnh viễn khỏi `/profile`, catch-up sau này chỉ đi tới không bao giờ quay lại. Verify bằng RPC thật: ví `0x9E8CFf3CCE6A4Ba5e233bF013618eA8026AAfC38` có 24 bill trải từ block 50.298.310 tới 53.946.434 (~4,27 triệu block từ lúc deploy) — cửa sổ 40.000 block bỏ sót gần hết.

**Fix — kiến trúc seed file tĩnh** (RPC public giới hạn cứng 10.000 block/`eth_getLogs` + rate-limit riêng, verify bằng `curl` thật, không thể quét full lịch sử trong 1 lần tải trang):

- `frontend-rk/scripts/build-history-seed.mjs` — script chạy 1 lần ngoài app, quét TOÀN BỘ lịch sử 3 event từ block deploy tới latest (chunk 10.000, có checkpoint tự resume), output `frontend-rk/public/data/onchain-history-seed.json` (đã commit, ~34KB, 130 log, `cutoffBlock: 54580493` tính tới 2026-07-31). Không cần re-run định kỳ — catch-up runtime tự lo phần sau cutoff.
- `logCache.ts` thêm `logIndex` + `version: 2` (cache format cũ bị discard an toàn, seed đã thay thế).
- `eventScan.ts` gộp seed + cache local + log mới, dedup bằng `(transactionHash, logIndex)` — không dùng riêng `txHash`, không cắt theo block range. Gộp 2 nhánh "cold scan lùi"/"catch-up tới" cũ thành 1 mô hình: luôn quét tới từ `max(cache cursor, seed cutoff)`.
- **Riêng biệt:** `concurrency.ts` từng bị nới lên 4 request/200ms (rủi ro đã biết trước) — verify thật thấy RPC trả 429 hàng loạt (kể cả gây lỗi CORS trên production `sabi-arc.vercel.app`) → **đã revert về 2 request/400ms**, giá trị này đã verify an toàn qua thực nghiệm, đừng nới lại nếu không đo được bằng chứng cụ thể.
- **Riêng biệt:** `useProfileData.ts`/`profile.tsx` từng nuốt lỗi im lặng (query fail → hiện "chưa có bill" như thật) — thêm `isError`/`refetch`, banner vàng + nút "Thử lại".
- Verify: `npm run build` sạch, chủ dự án xác nhận trên browser thật `/profile` hiện đúng 24 bill (có 1 React hydration warning dev-mode-only ở `FaucetMenu`/`SabiHeader.tsx`, không đụng tới, không phải bug thật).

**Phát hiện phụ, đã báo không tự sửa:** file `.env` ở ROOT repo (khác `frontend-rk/.env.local`) có `PRIVATE_KEY` thật dạng plaintext + flag Circle login không comment — đã verify nằm trong `.gitignore`, KHÔNG được git track, không lộ lên GitHub. Chủ dự án tự quyết có dọn/rotate key không.

**Việc còn pending:**

1. Xác nhận trạng thái "Verified" cuối trên `https://testnet.arcscan.app/address/0x192963eBcC9f39C0057597CF3AA7d97c99a83c75`.
2. File `.env` root chứa private key thật — chưa có quyết định dọn/rotate.
3. Commit cuối cùng của các thay đổi mô tả ở trên (concurrency revert, seed file, isError fix) — kiểm tra `git log` khi đọc lại để biết chắc đã push hay chưa.

Chi tiết đầy đủ (bằng chứng cụ thể, lệnh đã chạy, block/tx cụ thể): xem `memory/project_sabi_phase1.md` (file trong repo này).

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
