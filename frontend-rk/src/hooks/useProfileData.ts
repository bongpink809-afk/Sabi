import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useReadContracts } from 'wagmi'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI } from '../lib/contracts'
import { scanEventLogs } from '../lib/eventScan'
import { rpcRetryQueryOptions } from '../lib/rpcRetry'
import { useRetryOnPartialFailure } from './useRetryPartialMulticall'
import { arcTestnet } from '../wagmi'

export interface CreatedBill {
  billId: bigint
  mode: number // 0 = ASSIGNED, 1 = OPEN_SLOT
  totalAmount: bigint
  txHash: `0x${string}`
  blockNumber: bigint
}

export interface PaymentMade {
  billId: bigint
  amount: bigint
  txHash: `0x${string}`
  blockNumber: bigint
}

interface ProfileData {
  billsCreated: CreatedBill[]
  paymentsMade: PaymentMade[]
  totalContributed: bigint
  // Số share ASSIGNED đã trả theo billId (key = billId.toString()) — đếm từ
  // SharePaid đã quét sẵn ở đây, dùng để hiện badge tiến độ ở Hồ sơ mà
  // không cần quét log riêng lần nữa (mỗi shareId chỉ emit SharePaid đúng 1 lần
  // nhờ guard AlreadyPaid trong contract, nên đếm log = đếm share đã trả).
  paidShareCountByBillId: Record<string, number>
  isLoading: boolean
}

async function fetchProfileData(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  address: `0x${string}`
) {
  const latestBlock = await publicClient.getBlockNumber()

  // 3 event quét song song trở lại — withGlobalConcurrency() ở scanLogs() đã
  // giới hạn tổng số request đồng thời lên RPC qua 1 semaphore DÙNG CHUNG,
  // nên chạy song song ở đây không còn làm tổng tải vượt ngưỡng như trước
  // (lúc đó mỗi scanLogs tự giới hạn riêng, cộng dồn 3x khi chạy cùng lúc).
  // organizer CÓ indexed trong BillCreated → lọc qua topics; payer KHÔNG indexed
  // trong SharePaid/SlotFilled → phải quét hết rồi tự so địa chỉ ở client.
  // Cache key: BillCreated lọc theo organizer nên phải riêng theo địa chỉ ví;
  // SharePaid/SlotFilled quét KHÔNG lọc (payer không indexed) nên dùng chung 1
  // key cho mọi ví trên cùng trình duyệt — dữ liệu on-chain vốn giống nhau.
  const addressKey = address.toLowerCase()
  const [createdLogs, shareLogs, slotLogs] = await Promise.all([
    scanEventLogs(publicClient, 'BillCreated', { organizer: address }, latestBlock, `sabi-scan-BillCreated-${addressKey}`),
    scanEventLogs(publicClient, 'SharePaid', undefined, latestBlock, 'sabi-scan-SharePaid'),
    scanEventLogs(publicClient, 'SlotFilled', undefined, latestBlock, 'sabi-scan-SlotFilled'),
  ])

  // Sort mới nhất trước — dùng blockNumber vì thứ tự log trả về giữa các chunk
  // (quét lùi từ block mới nhất) không đảm bảo chronological toàn cục.
  const byBlockDesc = (a: { blockNumber: bigint }, b: { blockNumber: bigint }) =>
    b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0

  const created: CreatedBill[] = createdLogs
    .map((log: any) => ({
      billId: log.args.billId,
      mode: log.args.mode,
      totalAmount: log.args.totalAmount,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    }))
    .sort(byBlockDesc)

  const addressLower = address.toLowerCase()
  const payments: PaymentMade[] = [...shareLogs, ...slotLogs]
    .filter((log: any) => (log.args.payer as string).toLowerCase() === addressLower)
    .map((log: any) => ({
      billId: log.args.billId,
      amount: log.args.amount,
      txHash: log.transactionHash,
      blockNumber: log.blockNumber,
    }))
    .sort(byBlockDesc)

  const totalContributed = payments.reduce((sum, p) => sum + p.amount, 0n)

  const paidShareCountByBillId: Record<string, number> = {}
  for (const log of shareLogs as any[]) {
    const key = log.args.billId.toString()
    paidShareCountByBillId[key] = (paidShareCountByBillId[key] ?? 0) + 1
  }

  return { billsCreated: created, paymentsMade: payments, totalContributed, paidShareCountByBillId }
}

export function useProfileData(address: `0x${string}` | undefined): ProfileData {
  const publicClient = usePublicClient({ chainId: arcTestnet.id })

  // useQuery cache theo address — quay lại /profile trong vòng 30s không phải
  // quét log lại từ đầu (trước đây mỗi lần vào trang đều quét mới, cảm giác "hơi lâu"
  // dù chỉ vừa xem xong). Bấm qua lại tab Hồ sơ nhiều lần trong phiên sẽ thấy ngay.
  const { data, isLoading } = useQuery({
    queryKey: ['profileData', address],
    queryFn: () => fetchProfileData(publicClient!, address!),
    enabled: !!address && !!publicClient,
    staleTime: 30_000,
  })

  return {
    billsCreated: data?.billsCreated ?? [],
    paymentsMade: data?.paymentsMade ?? [],
    totalContributed: data?.totalContributed ?? 0n,
    paidShareCountByBillId: data?.paidShareCountByBillId ?? {},
    isLoading,
  }
}

export interface BillProgress {
  paidCount: number
  totalCount: number
}

// Badge "ĐANG THU"/"ĐÃ ĐỦ" ở Hồ sơ — gộp getBill + shareCount của TẤT CẢ bill
// đang hiển thị thành 1 lần gọi multicall (Multicall3 có thật trên Arc Testnet,
// đã verify qua eth_getCode) thay vì N lần đọc rời rạc.
export function useBillsProgress(
  billIds: bigint[],
  paidShareCountByBillId: Record<string, number>
): Record<string, BillProgress> {
  const contracts = billIds.flatMap((id) => [
    { address: SABI_BILL_ADDRESS, abi: SABI_BILL_ABI, functionName: 'getBill', args: [id], chainId: arcTestnet.id } as const,
    { address: SABI_BILL_ADDRESS, abi: SABI_BILL_ABI, functionName: 'shareCount', args: [id], chainId: arcTestnet.id } as const,
  ])

  const { data, refetch } = useReadContracts({
    contracts,
    query: { enabled: billIds.length > 0, ...rpcRetryQueryOptions },
  })

  // allowFailure:true (mặc định) khiến 1 phần tử lỗi trong multicall không làm
  // query báo lỗi tổng thể — rpcRetryQueryOptions ở trên không kích hoạt được
  // cho trường hợp này, phải tự phát hiện + refetch riêng.
  useRetryOnPartialFailure(data, refetch)

  const result: Record<string, BillProgress> = {}
  billIds.forEach((id, i) => {
    const billRes = data?.[i * 2]
    const shareCountRes = data?.[i * 2 + 1]
    if (!billRes || billRes.status !== 'success') return
    const bill = billRes.result as {
      mode: number
      totalAmount: bigint
      amountPerSlot: bigint
      numSlots: bigint
      matchedSlotsCount: bigint
      extraReceived: bigint
    }
    const key = id.toString()
    if (bill.mode === 0) {
      const totalCount = shareCountRes && shareCountRes.status === 'success' ? Number(shareCountRes.result as bigint) : 0
      result[key] = { paidCount: paidShareCountByBillId[key] ?? 0, totalCount }
    } else {
      result[key] = { paidCount: Number(bill.matchedSlotsCount), totalCount: Number(bill.numSlots) }
    }
  })
  return result
}
