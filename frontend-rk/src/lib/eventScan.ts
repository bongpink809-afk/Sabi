import { usePublicClient } from 'wagmi'
import { HttpRequestError } from 'viem'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI, SABI_BILL_DEPLOY_BLOCK } from './contracts'
import { loadCachedLogs, saveCachedLogs, CachedRawLog, BIGINT_ARG_KEYS, deserializeArg } from './logCache'

// Dùng chung cho cả useProfileData.ts (Hồ sơ) lẫn bill/[id].tsx (chi tiết bill) —
// trước đây mỗi nơi tự copy 1 bản logic quét-chunk giống hệt nhau, khiến khi
// thêm cache incremental chỉ nhớ sửa 1 nơi (Hồ sơ), còn bill/[id].tsx vẫn quét
// lại từ đầu mỗi lần F5.

// Verify trực tiếp bằng eth_getLogs thật lên rpc.testnet.arc.network: RPC
// trả lỗi "-32614 eth_getLogs is limited to a 10,000 range" ở 40.000 block,
// chấp nhận đúng 10.000 block/lần — CHUNK_SIZE dùng đúng bằng giới hạn thật.
const CHUNK_SIZE = 10000n
// Giới hạn số chunk quét mỗi lần vào trang (áp dụng cho phần SAU seed, xem
// loadSeed() bên dưới) — seed đã gánh toàn bộ lịch sử cũ, nên phần còn lại mỗi
// lần catch-up thường rất nhỏ; giữ giới hạn này để không dội quá tải RPC public
// nếu ai đó không mở app trong thời gian dài.
const MAX_CHUNKS = 4

// ─── Seed file tĩnh: lịch sử đầy đủ từ block deploy tới 1 cutoff cố định, quét
// 1 lần bằng scripts/build-history-seed.mjs (chạy ngoài, không phải lúc build)
// vì RPC public giới hạn 10.000 block/request + có rate-limit riêng, quét full
// ~4,27 triệu block trong 1 lần tải trang không khả thi. Từ cutoff trở đi, mọi
// việc quét tiếp vẫn diễn ra bình thường qua cơ chế catch-up như trước — seed
// không cần re-run định kỳ, chỉ là "nền" lịch sử cũ, không phải nguồn dữ liệu
// sống duy nhất.
interface SeedLog {
  eventName: 'BillCreated' | 'SharePaid' | 'SlotFilled'
  args: Record<string, string | number | boolean>
  transactionHash: `0x${string}`
  blockNumber: string
  logIndex: number
}

interface Seed {
  cutoffBlock: bigint
  logsByEvent: Record<'BillCreated' | 'SharePaid' | 'SlotFilled', CachedRawLog[]>
}

let seedPromise: Promise<Seed | null> | null = null

function loadSeed(): Promise<Seed | null> {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (!seedPromise) {
    seedPromise = fetch('/data/onchain-history-seed.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { cutoffBlock: string; logs: SeedLog[] } | null) => {
        if (!json) return null
        const logsByEvent: Seed['logsByEvent'] = { BillCreated: [], SharePaid: [], SlotFilled: [] }
        for (const l of json.logs) {
          logsByEvent[l.eventName].push({
            args: Object.fromEntries(
              Object.entries(l.args).map(([k, v]) => [k, BIGINT_ARG_KEYS.has(k) ? deserializeArg(k, String(v)) : v])
            ),
            transactionHash: l.transactionHash,
            blockNumber: BigInt(l.blockNumber),
            logIndex: l.logIndex,
          })
        }
        return { cutoffBlock: BigInt(json.cutoffBlock), logsByEvent }
      })
      .catch(() => null) // seed thiếu/lỗi mạng — coi như không có, quét sẽ tự lùi về từ SABI_BILL_DEPLOY_BLOCK
  }
  return seedPromise
}

// So khớp args filter (vd { organizer } hay { billId }) với 1 log đã cache/seed —
// String() cả 2 vế để không phân biệt bigint (từ caller) với string (sau JSON
// round-trip của cache/seed).
function matchesArgs(log: CachedRawLog, args: Record<string, unknown> | undefined): boolean {
  if (!args) return true
  return Object.entries(args).every(([k, v]) => String(log.args[k]) === String(v))
}

// Khử trùng lặp log khi gộp seed + cache + kết quả quét mới — PHẢI dùng cặp
// (transactionHash, logIndex), đây là định danh duy nhất thật sự của 1 log
// trên chain (không dùng riêng txHash: 1 tx có thể emit nhiều log cùng loại
// event nếu sau này có hàm batch; không cắt theo block range vì seed và cache
// cũ có thể chồng lấn phạm vi đã quét).
function dedupeLogs(logs: CachedRawLog[]): CachedRawLog[] {
  const seen = new Set<string>()
  const result: CachedRawLog[] = []
  for (const log of logs) {
    const key = `${log.transactionHash}:${log.logIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(log)
  }
  return result
}

// Export để useProfileData.ts / profile.tsx dùng lại đúng policy retry này cho
// các lệnh RPC đơn lẻ (getBlockNumber, getTransaction) — tránh viết trùng vòng
// lặp retry lần thứ 3 trong app (đã có ở đây + getBlockNumberWithRetry riêng
// trong useLandingStats.ts).
// retries=3: trước đây 5 lần/backoff x2 (800→1600→3200→6400→12800) cộng dồn
// tới ~24.8s cho 1 request kẹt 429 liên tục — nếu request đó nằm trên đường
// găng (vd getBill quyết định "Loading bill info..." biến mất lúc nào) làm
// cả trang treo tới nửa phút, rủi ro thật cho demo. Giảm còn 3 lần
// (800→1600→3200, tổng tối đa ~5.6s) — ưu tiên "fail nhanh, có UI fallback +
// nút thử lại" hơn "chờ lâu, im lặng, không biết đang chờ gì".
export async function withRetry429<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    // status === 429: rate-limit thật từ RPC. status === undefined: fetch() tự
    // throw (mất mạng/RPC không phản hồi tạm thời) — viem bọc lại thành
    // HttpRequestError nhưng KHÔNG có status vì chưa nhận được response nào cả
    // (xem viem/utils/rpc/http.ts, nhánh catch ngoài cùng). Trước đây chỉ retry
    // đúng 429 nên loại lỗi mạng thoáng qua này rớt luôn không thử lại.
    const isRetryable = err instanceof HttpRequestError && (err.status === 429 || err.status === undefined)
    if (isRetryable && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
      return withRetry429(fn, retries - 1, delayMs * 2)
    }
    throw err
  }
}

export async function scanEventLogs(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  eventName: 'BillCreated' | 'SharePaid' | 'SlotFilled',
  args: Record<string, unknown> | undefined,
  latestBlock: bigint,
  cacheKey: string
): Promise<any[]> {
  const seed = await loadSeed()
  const seedLogs = (seed?.logsByEvent[eventName] ?? []).filter((log) => matchesArgs(log, args))
  // Không có seed (lỗi mạng/chưa deploy file) — coi như "nền" bắt đầu ngay
  // trước block deploy, quét sẽ tự chảy từ đó lên (chậm hơn nhưng không sai).
  const seedFloor = seed ? seed.cutoffBlock : SABI_BILL_DEPLOY_BLOCK - 1n

  // cached (nếu có) giờ CHỈ còn chứa phần log phát sinh SAU seedFloor — xem
  // logCache.ts. lastScannedBlock của nó luôn ≥ seedFloor một khi đã tồn tại
  // (được set từ chính hàm này), nên chỉ cần so 2 giá trị lấy cái lớn hơn.
  const cached = loadCachedLogs(cacheKey)
  const startCursor = cached && cached.lastScannedBlock > seedFloor ? cached.lastScannedBlock : seedFloor

  if (startCursor >= latestBlock) {
    return dedupeLogs([...seedLogs, ...(cached?.logs ?? [])])
  }

  const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
  let fromCursor = startCursor + 1n
  let chunkCount = 0
  while (fromCursor <= latestBlock && chunkCount < MAX_CHUNKS) {
    const toBlock = fromCursor + CHUNK_SIZE - 1n > latestBlock ? latestBlock : fromCursor + CHUNK_SIZE - 1n
    ranges.push({ fromBlock: fromCursor, toBlock })
    chunkCount++
    fromCursor = toBlock + 1n
  }

  // eslint-disable-next-line no-console
  console.log(`[profile-perf] ${cacheKey}: catch-up từ block ${startCursor}, ${ranges.length} chunk(s)`)
  // eslint-disable-next-line no-console
  console.time(`[profile-perf] ${cacheKey} chunks`)
  const chunkResults = await Promise.all(
    ranges.map(({ fromBlock, toBlock }) =>
      // Throttle giờ nằm ở tầng transport (wagmi.ts, arcThrottledFetch) — bọc
      // withGlobalConcurrency thêm ở đây sẽ chiếm 2 slot/lệnh (1 slot ngoài này +
      // 1 slot khi fetch thật sự bắn ở tầng transport), làm chậm gấp đôi không
      // cần thiết mà không tăng an toàn gì thêm.
      withRetry429(() =>
        publicClient.getContractEvents({
          address: SABI_BILL_ADDRESS,
          abi: SABI_BILL_ABI,
          eventName,
          args,
          fromBlock,
          toBlock,
        })
      )
    )
  )
  // eslint-disable-next-line no-console
  console.timeEnd(`[profile-perf] ${cacheKey} chunks`)
  const newLogs = chunkResults.flat()
  // Chỉ lưu phần SAU seed vào localStorage — seed tự nó đã có sẵn (static
  // asset, browser cache riêng), không cần chép lại vào từng cache key.
  const mergedIncremental = dedupeLogs([...(cached?.logs ?? []), ...newLogs])
  const newCursor = ranges[ranges.length - 1].toBlock
  saveCachedLogs(cacheKey, newCursor, mergedIncremental)

  return dedupeLogs([...seedLogs, ...mergedIncremental])
}
