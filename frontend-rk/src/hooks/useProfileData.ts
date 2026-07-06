import { useQuery } from '@tanstack/react-query'
import { usePublicClient, useReadContracts } from 'wagmi'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI, SABI_BILL_DEPLOY_BLOCK } from '../lib/contracts'
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

// Cùng kiểu quét theo chunk đã dùng ở bill/[id].tsx — Arc Testnet giới hạn
// số block/lần gọi getLogs, quét cả chain 1 lần bị lỗi 413.
const CHUNK_SIZE = 5000n
const MAX_CHUNKS = 50

async function scanLogs(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  eventName: 'BillCreated' | 'SharePaid' | 'SlotFilled',
  args: Record<string, unknown> | undefined,
  latestBlock: bigint
): Promise<any[]> {
  const allLogs: any[] = []
  let toBlock = latestBlock
  let chunkCount = 0
  while (toBlock >= 0n && chunkCount < MAX_CHUNKS) {
    const rawFrom = toBlock > CHUNK_SIZE ? toBlock - CHUNK_SIZE + 1n : 0n
    const fromBlock = rawFrom < SABI_BILL_DEPLOY_BLOCK ? SABI_BILL_DEPLOY_BLOCK : rawFrom
    const logs = await publicClient.getContractEvents({
      address: SABI_BILL_ADDRESS,
      abi: SABI_BILL_ABI,
      eventName,
      args,
      fromBlock,
      toBlock,
    })
    allLogs.push(...logs)
    chunkCount++
    if (fromBlock <= SABI_BILL_DEPLOY_BLOCK) break
    toBlock = fromBlock - 1n
  }
  return allLogs
}

async function fetchProfileData(
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>,
  address: `0x${string}`
) {
  const latestBlock = await publicClient.getBlockNumber()

  // Cả 3 event quét song song (trước đây BillCreated quét xong mới quét tiếp
  // 2 event kia — gộp thành 1 Promise.all giảm gần nửa thời gian chờ thật).
  // organizer CÓ indexed trong BillCreated → lọc qua topics; payer KHÔNG indexed
  // trong SharePaid/SlotFilled → phải quét hết rồi tự so địa chỉ ở client.
  const [createdLogs, shareLogs, slotLogs] = await Promise.all([
    scanLogs(publicClient, 'BillCreated', { organizer: address }, latestBlock),
    scanLogs(publicClient, 'SharePaid', undefined, latestBlock),
    scanLogs(publicClient, 'SlotFilled', undefined, latestBlock),
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

  const { data } = useReadContracts({
    contracts,
    query: { enabled: billIds.length > 0 },
  })

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
