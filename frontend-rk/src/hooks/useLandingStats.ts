import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { formatUnits, HttpRequestError } from 'viem'
import { arcTestnet } from '../wagmi'
import { scanEventLogs } from '../lib/eventScan'

interface LandingStats {
  billsCreated: number
  usdcSettled: number
  isLoading: boolean
}

// getBlockNumber() ở đây là request ĐẦU TIÊN, chưa qua bất kỳ concurrency/retry
// nào — verify thật lúc build tính năng này thấy nó thoáng qua bị lỗi "Failed to
// fetch" (RPC public quá tải trả response thiếu header CORS, trình duyệt báo
// nhầm thành lỗi CORS — xem curl verify: cùng request retry vài lần sau đó
// pass bình thường). status === 429: rate-limit thật. status === undefined:
// fetch() tự throw (mất mạng/RPC không phản hồi tạm thời), viem bọc thành
// HttpRequestError nhưng không có status vì chưa nhận được response nào.
async function getBlockNumberWithRetry(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  retries = 3,
  delayMs = 800
): Promise<bigint> {
  try {
    return await publicClient.getBlockNumber()
  } catch (err) {
    const isRetryable = err instanceof HttpRequestError && (err.status === 429 || err.status === undefined)
    if (isRetryable && retries > 0) {
      await new Promise((r) => setTimeout(r, delayMs))
      return getBlockNumberWithRetry(publicClient, retries - 1, delayMs * 2)
    }
    throw err
  }
}

// Số liệu thật cho khối "Sabi by the numbers" ở landing page — quét TOÀN BỘ
// lịch sử 3 event, KHÔNG filter theo organizer/payer (khác useProfileData.ts,
// luôn lọc theo 1 ví), nên dùng cacheKey riêng để không đụng cache của trang đó.
// "Source chains supported" (3) và "Average settlement time" (~20s) là thông
// tin sản phẩm cố định (CCTP V2 Fast Transfer trên 3 chain nguồn hỗ trợ), không
// phải số liệu đọc từ chain — không cần wiring, xem index.tsx.
export function useLandingStats(): LandingStats {
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const [billsCreated, setBillsCreated] = useState(0)
  const [usdcSettled, setUsdcSettled] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    ;(async () => {
      try {
        const latestBlock = await getBlockNumberWithRetry(publicClient)
        const [created, sharePaid, slotFilled] = await Promise.all([
          scanEventLogs(publicClient, 'BillCreated', undefined, latestBlock, 'sabi-scan-BillCreated-landing'),
          scanEventLogs(publicClient, 'SharePaid', undefined, latestBlock, 'sabi-scan-SharePaid-landing'),
          scanEventLogs(publicClient, 'SlotFilled', undefined, latestBlock, 'sabi-scan-SlotFilled-landing'),
        ])
        if (cancelled) return
        const totalRaw: bigint = [...sharePaid, ...slotFilled].reduce(
          (sum: bigint, log: any) => sum + (log.args.amount as bigint),
          0n
        )
        setBillsCreated(created.length)
        setUsdcSettled(Math.round(Number(formatUnits(totalRaw, 6))))
      } catch (err) {
        console.error('Lỗi đọc thống kê landing:', err)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [publicClient])

  return { billsCreated, usdcSettled, isLoading }
}
