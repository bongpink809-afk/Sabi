// Cache kết quả quét getContractEvents vào localStorage theo cursor block —
// tránh phải quét lại từ đầu mỗi lần vào trang Hồ sơ. Từ khi có seed file tĩnh
// (xem eventScan.ts), cache ở đây CHỈ còn giữ phần log PHÁT SINH SAU cutoff của
// seed — lịch sử cũ hơn đã nằm sẵn trong seed, không cần lưu trùng vào từng
// trình duyệt nữa.
export interface CachedRawLog {
  args: Record<string, unknown>
  transactionHash: `0x${string}`
  blockNumber: bigint
  logIndex: number
}

interface StoredEntry {
  version: number
  lastScannedBlock: string
  logs: {
    args: Record<string, string>
    transactionHash: string
    blockNumber: string
    logIndex: number
  }[]
}

// Bump khi đổi format lưu (vd thêm field mới cần cho dedup) — cache ghi bởi
// version cũ bị coi như KHÔNG có (loadCachedLogs trả null), không cố tái sử
// dụng dữ liệu thiếu field mới. An toàn vì lịch sử cũ giờ đã có trong seed file
// tĩnh (eventScan.ts) rồi, không mất thông tin thật nào khi discard cache cũ.
const CURRENT_VERSION = 2

// Các key trong `args` mang giá trị uint256 (bigint) — còn lại (address, bool,
// enum số nhỏ như `mode`) xử lý riêng bên dưới. Export để eventScan.ts dùng lại
// đúng logic này khi parse seed file tĩnh (tránh viết trùng 2 nơi).
export const BIGINT_ARG_KEYS = new Set(['billId', 'shareId', 'amount', 'totalAmount'])

export function serializeArg(value: unknown): string {
  return typeof value === 'bigint' ? value.toString() : String(value)
}

export function deserializeArg(key: string, value: string): unknown {
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
    if (parsed.version !== CURRENT_VERSION) return null
    return {
      lastScannedBlock: BigInt(parsed.lastScannedBlock),
      logs: parsed.logs.map((l) => ({
        args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, deserializeArg(k, v)])),
        transactionHash: l.transactionHash as `0x${string}`,
        blockNumber: BigInt(l.blockNumber),
        logIndex: l.logIndex,
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
      version: CURRENT_VERSION,
      lastScannedBlock: lastScannedBlock.toString(),
      logs: logs.map((l) => ({
        args: Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, serializeArg(v)])),
        transactionHash: l.transactionHash,
        blockNumber: l.blockNumber.toString(),
        logIndex: l.logIndex,
      })),
    }
    localStorage.setItem(cacheKey, JSON.stringify(entry))
  } catch {
    // localStorage đầy/bị chặn — bỏ qua, không cache được thì lần sau quét lại như chưa có cache
  }
}
