// Cache kết quả quét getContractEvents vào localStorage theo cursor block —
// tránh phải quét lại từ đầu mỗi lần vào trang Hồ sơ. Lần đầu (chưa có cache)
// vẫn quét window gần nhất như bình thường; từ lần sau chỉ quét thêm phần
// block MỚI kể từ lần quét trước rồi gộp vào log đã cache — lịch sử tích luỹ
// dần theo thời gian dùng thay vì luôn bị cắt về 1 window cố định.
export interface CachedRawLog {
  args: Record<string, unknown>
  transactionHash: `0x${string}`
  blockNumber: bigint
}

interface StoredEntry {
  lastScannedBlock: string
  logs: {
    args: Record<string, string>
    transactionHash: string
    blockNumber: string
  }[]
}

// Các key trong `args` mang giá trị uint256 (bigint) — còn lại (address, bool,
// enum số nhỏ như `mode`) xử lý riêng bên dưới.
const BIGINT_ARG_KEYS = new Set(['billId', 'shareId', 'amount', 'totalAmount'])

function serializeArg(value: unknown): string {
  return typeof value === 'bigint' ? value.toString() : String(value)
}

function deserializeArg(key: string, value: string): unknown {
  if (BIGINT_ARG_KEYS.has(key)) return BigInt(value)
  if (key === 'mode') return Number(value)
  if (value === 'true' || value === 'false') return value === 'true'
  return value
}

export function loadCachedLogs(cacheKey: string): { lastScannedBlock: bigint; logs: CachedRawLog[] } | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKey)
    if (!raw) return null
    const parsed: StoredEntry = JSON.parse(raw)
    return {
      lastScannedBlock: BigInt(parsed.lastScannedBlock),
      logs: parsed.logs.map((l) => ({
        args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, deserializeArg(k, v)])),
        transactionHash: l.transactionHash as `0x${string}`,
        blockNumber: BigInt(l.blockNumber),
      })),
    }
  } catch {
    // Cache hỏng/không đọc được — coi như chưa có, quét lại window gần nhất bình thường
    return null
  }
}

export function saveCachedLogs(cacheKey: string, lastScannedBlock: bigint, logs: CachedRawLog[]): void {
  if (typeof window === 'undefined') return
  try {
    const entry: StoredEntry = {
      lastScannedBlock: lastScannedBlock.toString(),
      logs: logs.map((l) => ({
        args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, serializeArg(v)])),
        transactionHash: l.transactionHash,
        blockNumber: l.blockNumber.toString(),
      })),
    }
    localStorage.setItem(cacheKey, JSON.stringify(entry))
  } catch {
    // localStorage đầy/bị chặn — bỏ qua, không cache được thì lần sau quét lại như chưa có cache
  }
}
