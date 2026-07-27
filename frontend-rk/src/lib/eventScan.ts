import { usePublicClient } from 'wagmi'
import { HttpRequestError } from 'viem'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI, SABI_BILL_DEPLOY_BLOCK } from './contracts'
import { withGlobalConcurrency } from './concurrency'
import { loadCachedLogs, saveCachedLogs, CachedRawLog } from './logCache'

// Dùng chung cho cả useProfileData.ts (Hồ sơ) lẫn bill/[id].tsx (chi tiết bill) —
// trước đây mỗi nơi tự copy 1 bản logic quét-chunk giống hệt nhau, khiến khi
// thêm cache incremental chỉ nhớ sửa 1 nơi (Hồ sơ), còn bill/[id].tsx vẫn quét
// lại từ đầu mỗi lần F5.

const CHUNK_SIZE = 5000n
// Khoảng cách từ block deploy contract tới hiện tại đã hơn 3 triệu block, nên
// vòng lặp luôn chạm giới hạn này — tức MAX_CHUNKS chunk luôn được bắn ra ở
// lần quét đầu tiên (chưa có cache). Giữ nhỏ để không dội quá tải RPC public.
const MAX_CHUNKS = 8

async function withRetry429<T>(fn: () => Promise<T>, retries = 5, delayMs = 800): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof HttpRequestError && err.status === 429 && retries > 0) {
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
  const cached = loadCachedLogs(cacheKey)

  // Đã cache tới tận block mới nhất rồi — khỏi cần quét gì thêm.
  if (cached && cached.lastScannedBlock >= latestBlock) {
    return cached.logs
  }

  const ranges: { fromBlock: bigint; toBlock: bigint }[] = []

  if (cached) {
    // Đã có cache — chỉ quét TIẾP phần block mới kể từ lần trước, đi TỚI,
    // thường chỉ 1 chunk nhỏ.
    let fromCursor = cached.lastScannedBlock + 1n
    let chunkCount = 0
    while (fromCursor <= latestBlock && chunkCount < MAX_CHUNKS) {
      const toBlock = fromCursor + CHUNK_SIZE - 1n > latestBlock ? latestBlock : fromCursor + CHUNK_SIZE - 1n
      ranges.push({ fromBlock: fromCursor, toBlock })
      chunkCount++
      fromCursor = toBlock + 1n
    }
  } else {
    // Lần đầu, chưa có cache — quét LÙI từ block mới nhất, giới hạn MAX_CHUNKS
    // chunk để không quét quá xa về trước.
    let toBlock = latestBlock
    let chunkCount = 0
    while (toBlock >= 0n && chunkCount < MAX_CHUNKS) {
      const rawFrom = toBlock > CHUNK_SIZE ? toBlock - CHUNK_SIZE + 1n : 0n
      const fromBlock = rawFrom < SABI_BILL_DEPLOY_BLOCK ? SABI_BILL_DEPLOY_BLOCK : rawFrom
      ranges.push({ fromBlock, toBlock })
      chunkCount++
      if (fromBlock <= SABI_BILL_DEPLOY_BLOCK) break
      toBlock = fromBlock - 1n
    }
  }

  const chunkResults = await Promise.all(
    ranges.map(({ fromBlock, toBlock }) =>
      withGlobalConcurrency(() =>
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
  )
  const newLogs = chunkResults.flat()
  const merged: CachedRawLog[] = cached ? [...cached.logs, ...newLogs] : newLogs

  // Cursor mới: nhánh "lần đầu" (quét lùi) luôn phủ tới latestBlock ngay từ
  // chunk đầu tiên; nhánh "đã cache" (quét tới) có thể bị MAX_CHUNKS chặn giữa
  // chừng nếu khoảng trống quá lớn — lưu đúng block xa nhất thực sự đã quét
  // tới, phần còn thiếu sẽ được quét tiếp ở lần vào trang kế tiếp.
  const newCursor = cached ? ranges[ranges.length - 1].toBlock : latestBlock
  saveCachedLogs(cacheKey, newCursor, merged)

  return merged
}
