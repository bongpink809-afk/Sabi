// Giới hạn request RPC trên TOÀN APP (module-level singleton) — không chỉ số
// request chạy song song, mà cả TỐC ĐỘ dồn dập: dù chỉ 2-3 request cùng lúc,
// nếu request cũ vừa xong là bắn request mới ngay lập tức thì vẫn có thể vượt
// giới hạn request/giây thật sự của RPC public (khác với giới hạn số kết nối
// đồng thời). Rate limiter dưới đây ép thêm khoảng cách tối thiểu giữa 2 lần
// bắn request, không chỉ giới hạn concurrency.
class RateLimiter {
  private active = 0
  private queue: (() => void)[] = []
  private lastStart = 0

  constructor(private readonly maxConcurrent: number, private readonly minIntervalMs: number) {}

  async acquire(): Promise<() => void> {
    await this.waitForSlot()
    const wait = this.lastStart + this.minIntervalMs - Date.now()
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait))
    }
    this.lastStart = Date.now()
    return () => this.release()
  }

  private waitForSlot(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++
        resolve()
      })
    })
  }

  private release() {
    this.active--
    const next = this.queue.shift()
    if (next) next()
  }
}

// Tối đa 2 request cùng lúc, cách nhau tối thiểu 400ms mỗi lần bắn — từng thử
// nới lên 4/200ms để tăng tốc lần quét đầu, nhưng verify thật bằng console cho
// thấy RPC public trả 429 hàng loạt ở mức đó (kèm cả lỗi CORS trên production,
// nhiều khả năng do RPC quá tải trả lỗi không kèm header CORS) — mỗi 429 phải
// retry với backoff tới ~25s (xem withRetry429 trong eventScan.ts), khiến
// /profile treo lâu hơn hẳn so với trước. Quay lại giá trị an toàn đã verify.
const rpcLimiter = new RateLimiter(2, 400)

export async function withGlobalConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  const release = await rpcLimiter.acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
