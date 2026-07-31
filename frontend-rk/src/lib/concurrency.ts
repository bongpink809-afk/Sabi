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

// Tối đa 4 request cùng lúc, cách nhau tối thiểu 200ms mỗi lần bắn — tăng gấp
// đôi throughput so với bản cũ (2 request/400ms) để lần quét đầu tiên (chưa có
// cache, tới 24 chunk cho 3 loại event) đỡ chậm. Retry 429/lỗi mạng thoáng qua
// đã có ở withRetry429() (eventScan.ts) nên nới giới hạn này chấp nhận được;
// nếu lại thấy 429 dội về nhiều, hạ số này xuống trước khi nghi ngờ chỗ khác.
const rpcLimiter = new RateLimiter(4, 200)

export async function withGlobalConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  const release = await rpcLimiter.acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}
