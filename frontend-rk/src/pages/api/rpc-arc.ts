// Proxy JSON-RPC cho Arc Testnet — rpc.testnet.arc.network không trả header
// Access-Control-Allow-Origin ở bước preflight (đã verify bằng curl + Network
// tab thật: "blocked by CORS policy", không phải lỗi thoáng qua) nên trình
// duyệt KHÔNG BAO GIỜ gọi thẳng được RPC này. Route này chạy trên server
// (Node, không bị CORS chi phối) nhận request từ chính app rồi forward hộ.
//
// Rate limiter + retry-cap đặt NGAY TRONG route này (không import lại object
// client-side cũ trong concurrency.ts) — vì trên serverless (Vercel) mỗi lượt
// gọi có thể rơi vào instance khác nhau, module state không share được giữa
// các lần gọi. Đặt ở đây throttle đúng lượt gọi THẬT ra internet (trong phạm
// vi 1 instance ấm), thay vì chỉ throttle được lượt trình duyệt gọi vào route.
import type { NextApiRequest, NextApiResponse } from 'next'

const ARC_RPC_URL = 'https://rpc.testnet.arc.network'

class RateLimiter {
  private active = 0
  private queue: (() => void)[] = []
  private lastStart = 0

  constructor(private readonly maxConcurrent: number, private readonly minIntervalMs: number) {}

  async acquire(): Promise<() => void> {
    await this.waitForSlot()
    const wait = this.lastStart + this.minIntervalMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
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

// Tối đa 2 request cùng lúc, cách nhau tối thiểu 400ms — giữ nguyên giá trị
// đã verify an toàn trước đây (concurrency.ts cũ), chỉ chuyển vị trí chạy.
const rpcLimiter = new RateLimiter(2, 400)

// Circuit breaker: tối đa 3 lần thử lại (4 lượt tổng) cho MỖI request forward
// sang RPC thật, backoff tăng dần (800ms → 1600 → 3200). Chỉ retry khi lỗi có
// khả năng thoáng qua (network fail / timeout / 429 / 5xx cổng vào như
// 502-504 của Cloudflare / rate-limit ở TẦNG JSON-RPC body — xem
// isRateLimitedJsonRpc) — hết lượt thì DỪNG HẲN, trả lỗi rõ ràng về client
// thay vì lặp vô hạn (Network tab từng thấy 1067 request liên tục cùng
// endpoint — dấu hiệu thiếu đúng giới hạn này).
//
// Tổng worst-case ~21.6s (4×4s timeout/attempt + 5.6s backoff cộng dồn) —
// PHẢI nhỏ hơn timeout 30s ở tầng client (xem wagmi.ts) — nếu proxy tự cho
// phép mất nhiều thời gian hơn client sẵn sàng chờ, client sẽ bỏ cuộc trước
// (TimeoutError), viem coi khác "chưa tìm thấy tx" nên reject ngay — đúng bug
// đã gặp khiến nút Approve/Pay kẹt "Processing" (xem comment trong wagmi.ts).
const MAX_RETRIES = 3
const REQUEST_TIMEOUT_MS = 4_000
const isRetryableStatus = (status: number) => status === 429 || (status >= 502 && status <= 504)

// RPC public này rate-limit ở TẦNG JSON-RPC (HTTP 200 kèm body
// {"error":{"code":-32005,"message":"rate limit exceeded"}}), không phải HTTP
// status — đã verify bằng curl thật. isRetryableStatus() chỉ check HTTP status
// nên lỗi dạng này lọt qua như response "thành công", không được retry — vá
// thêm nhánh riêng đọc body cho đúng.
function isRateLimitedJsonRpc(text: string): boolean {
  try {
    const parsed = JSON.parse(text)
    const code = parsed?.error?.code
    const message = String(parsed?.error?.message ?? '')
    return code === -32005 || /rate limit/i.test(message)
  } catch {
    return false
  }
}

async function forwardToRpc(body: unknown): Promise<{ status: number; text: string } | { networkError: true }> {
  let delay = 800
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const release = await rpcLimiter.acquire()
    try {
      // AbortController bắt buộc phải có — fetch() gốc của Node KHÔNG tự
      // timeout. Thiếu dòng này, 1 lần RPC thật treo (không trả lời, không
      // đóng connection) sẽ giữ vĩnh viễn 1 trong 2 slot của rpcLimiter, làm
      // TOÀN BỘ route đơ luôn cho mọi request sau — đã tự gây ra bug này thật
      // khi test dồn dập (curl treo >20s cả với eth_blockNumber đơn giản
      // nhất), phải restart dev server mới gỡ được deadlock.
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      let upstream: Response
      try {
        upstream = await fetch(ARC_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      const text = await upstream.text()
      const isRetryable =
        isRetryableStatus(upstream.status) || (upstream.status === 200 && isRateLimitedJsonRpc(text))
      if (isRetryable && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 10000)
        continue
      }
      return { status: upstream.status, text }
    } catch {
      // fetch tự throw = mất mạng / bị AbortController huỷ do quá REQUEST_TIMEOUT_MS
      // / RPC không phản hồi được (không có response nào để đọc status) —
      // cùng loại lỗi "Failed to fetch" đã verify trước đó.
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, delay))
        delay = Math.min(delay * 2, 10000)
        continue
      }
      return { networkError: true }
    } finally {
      release()
    }
  }
  return { networkError: true }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const result = await forwardToRpc(req.body)

  if ('networkError' in result) {
    const id = (req.body as { id?: unknown })?.id ?? null
    return res.status(502).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: 'Arc RPC proxy: hết lượt thử lại, RPC thật không phản hồi' },
    })
  }

  res.setHeader('Content-Type', 'application/json')
  return res.status(result.status).send(result.text)
}
