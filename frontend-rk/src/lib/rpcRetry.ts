import { HttpRequestError } from 'viem'

// RPC public Arc Testnet rate-limit (429) rất chặt — react-query mặc định chỉ
// retry 1 lần (xem QueryClient ở _app.tsx), không đủ để chịu 429 thoáng qua.
// Áp dụng cho MỌI useReadContract/useReadContracts đọc từ Arc: thiếu retry
// riêng cho 429 khiến 1 vài read trong multicall (vd getShare của từng người
// tham gia) âm thầm rớt trạng thái 'error' — component tương ứng tưởng share
// đó chưa có dữ liệu nên tự ẩn luôn, dù share đó vẫn tồn tại thật trên chain.
function isRateLimited(error: unknown): boolean {
  let err: unknown = error
  while (err) {
    if (err instanceof HttpRequestError && err.status === 429) return true
    if (typeof (err as { status?: unknown })?.status === 'number' && (err as { status: number }).status === 429) return true
    err = (err as { cause?: unknown })?.cause
  }
  return false
}

export const rpcRetryQueryOptions = {
  retry: (failureCount: number, error: unknown) => isRateLimited(error) && failureCount < 5,
  retryDelay: (attemptIndex: number) => Math.min(800 * 2 ** attemptIndex, 10000),
}
