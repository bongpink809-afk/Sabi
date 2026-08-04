import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchBillsByOrganizer, fetchPaymentsByPayer } from '../lib/firebase'

export interface CreatedBill {
  billId: bigint
  mode: number // 0 = ASSIGNED, 1 = OPEN_SLOT
  totalAmount: bigint
  txHash: `0x${string}`
  blockNumber: bigint
  // Đủ dữ liệu để tính badge tiến độ ở useBillsProgress mà không cần đọc chain
  // lần nữa — mode ASSIGNED dùng shareCount/paidShareCount, OPEN_SLOT dùng
  // numSlots/matchedSlotsCount (field còn lại của mode kia luôn là 0).
  numSlots: number
  matchedSlotsCount: number
  shareCount: number
  paidShareCount: number
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
  isLoading: boolean
  isError: boolean
  refetch: () => void
}

async function fetchProfileData(address: `0x${string}`) {
  const addressLower = address.toLowerCase()
  // Đọc thẳng từ Firestore (script scripts/sync-firestore.mjs đã đồng bộ sẵn
  // từ chain) thay vì tự quét event BillCreated/SharePaid/SlotFilled qua RPC.
  const [firestoreBills, firestorePayments] = await Promise.all([
    fetchBillsByOrganizer(addressLower),
    fetchPaymentsByPayer(addressLower),
  ])

  // Sort mới nhất trước theo blockNumber.
  const byBlockDesc = (a: { blockNumber: bigint }, b: { blockNumber: bigint }) =>
    b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0

  const created: CreatedBill[] = firestoreBills
    // Bill chưa được sync-firestore.mjs đồng bộ (chỉ có title/shareNames do
    // client ghi) thì chưa đủ dữ liệu on-chain — bỏ qua, hiện lại sau khi script chạy.
    .filter((b) => b.mode !== undefined && b.totalAmount !== undefined && b.txHash !== undefined && b.blockNumber !== undefined)
    .map((b) => {
      const shares = b.shares ?? []
      return {
        billId: BigInt(b.billId),
        mode: b.mode!,
        totalAmount: BigInt(b.totalAmount!),
        txHash: b.txHash as `0x${string}`,
        blockNumber: BigInt(b.blockNumber!),
        numSlots: b.numSlots ?? 0,
        matchedSlotsCount: b.matchedSlotsCount ?? 0,
        shareCount: shares.length,
        paidShareCount: shares.filter((s) => s.paid).length,
      }
    })
    .sort(byBlockDesc)

  const payments: PaymentMade[] = firestorePayments
    .map((p) => ({
      billId: BigInt(p.billId),
      amount: BigInt(p.amount),
      txHash: p.txHash as `0x${string}`,
      blockNumber: BigInt(p.blockNumber),
    }))
    .sort(byBlockDesc)

  const totalContributed = payments.reduce((sum, p) => sum + p.amount, 0n)

  return { billsCreated: created, paymentsMade: payments, totalContributed }
}

export function useProfileData(address: `0x${string}` | undefined): ProfileData {
  // useQuery cache theo address — quay lại /profile trong vòng 30s không phải
  // đọc Firestore lại từ đầu.
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['profileData', address],
    queryFn: () => fetchProfileData(address!),
    enabled: !!address,
    staleTime: 30_000,
  })

  return {
    billsCreated: data?.billsCreated ?? [],
    paymentsMade: data?.paymentsMade ?? [],
    totalContributed: data?.totalContributed ?? 0n,
    isLoading,
    isError,
    refetch: () => refetch(),
  }
}

export interface BillProgress {
  paidCount: number
  totalCount: number
}

// Badge "ĐANG THU"/"ĐÃ ĐỦ" ở Hồ sơ — derive thuần từ CreatedBill (đã có sẵn
// numSlots/matchedSlotsCount/shareCount/paidShareCount từ Firestore), không
// còn cần đọc chain (trước đây tự multicall getBill+shareCount riêng).
export function useBillsProgress(bills: CreatedBill[]): Record<string, BillProgress> {
  return useMemo(() => {
    const result: Record<string, BillProgress> = {}
    for (const b of bills) {
      const key = b.billId.toString()
      result[key] =
        b.mode === 0
          ? { paidCount: b.paidShareCount, totalCount: b.shareCount }
          : { paidCount: b.matchedSlotsCount, totalCount: b.numSlots }
    }
    return result
  }, [bills])
}
