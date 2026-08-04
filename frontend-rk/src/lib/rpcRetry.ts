import { HttpRequestError } from 'viem'

// RPC public Arc Testnet rate-limit (429) rất chặt — react-query mặc định chỉ
// retry 1 lần (xem QueryClient ở _app.tsx), không đủ để chịu 429 thoáng qua.
// Áp dụng cho MỌI useReadContract/useReadContracts đọc từ Arc: thiếu retry
// riêng cho 429 khiến 1 vài read trong multicall (vd getShare của từng người
// tham gia) âm thầm rớt trạng thái 'error' — component tương ứng tưởng share
// đó chưa có dữ liệu nên tự ẩn luôn, dù share đó vẫn tồn tại thật trên chain.
// status === 429: rate-limit thật. status === undefined trên HttpRequestError:
// fetch() tự throw (mất mạng/RPC không phản hồi tạm thời) — viem bọc lại
// thành HttpRequestError nhưng KHÔNG có status vì chưa nhận được response nào
// (xem viem/utils/rpc/http.ts, nhánh catch ngoài cùng). Trước đây chỉ coi 429
// là "nên retry" nên loại lỗi mạng thoáng qua này (vd "Failed to fetch") rớt
// thẳng thành error, không thử lại — đúng lỗi user gặp thật ngoài eth_getLogs.
function isRateLimited(error: unknown): boolean {
  let err: unknown = error
  while (err) {
    if (err instanceof HttpRequestError && (err.status === 429 || err.status === undefined)) return true
    if (typeof (err as { status?: unknown })?.status === 'number' && (err as { status: number }).status === 429) return true
    err = (err as { cause?: unknown })?.cause
  }
  return false
}

// failureCount < 3 (trước là 5): cùng lý do đã đổi withRetry429 trong
// eventScan.ts — 5 lần/backoff x2 cộng dồn tới ~22s cho 1 query kẹt 429 liên
// tục, đúng lúc query đó là getBill (quyết định "Loading bill info..." biến
// mất lúc nào) sẽ khiến cả trang treo rất lâu. Giảm còn 3 lần (~5.6s tối đa)
// — ưu tiên fail nhanh + UI fallback rõ ràng hơn chờ lâu không biết gì.
export const rpcRetryQueryOptions = {
  retry: (failureCount: number, error: unknown) => isRateLimited(error) && failureCount < 3,
  retryDelay: (attemptIndex: number) => Math.min(800 * 2 ** attemptIndex, 10000),
}
