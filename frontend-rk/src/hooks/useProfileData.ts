import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReadContracts } from 'wagmi'
import { fetchBillsByOrganizer, fetchPaymentsByPayer, fetchShareCodesByBillIds } from '../lib/firebase'
import type { PaymentDoc } from '../lib/firebase'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI } from '../lib/contracts'
import { arcTestnet } from '../wagmi'

// Lượt trả CHÍNH ví này vừa thực hiện, ghi tạm ở bill/[id].tsx (xem
// recordMyPaymentLocal ở đó) — collection Firestore "payments" chỉ được
// scripts/sync-firestore.mjs (Admin SDK) ghi, client không ghi thẳng được
// (rule write:false). Đọc gộp thêm nguồn này để /profile của CHÍNH ví vừa
// trả thấy ngay lượt vừa trả trên cùng trình duyệt, không đợi ai chạy tay
// script. Chỉ có tác dụng cùng trình duyệt — thiết bị khác vẫn phải đợi script.
export interface LocalPaymentEntry extends PaymentDoc {
  // Thời điểm ghi localStorage (Date.now()) — CHỈ dùng để sort, không phải dữ
  // liệu on-chain thật. blockNumber luôn = 0 cho tới khi sync-firestore.mjs
  // chạy và gán block thật (xem recordMyPaymentLocal).
  localWrittenAt: number
}

function getLocalPayments(address: string): LocalPaymentEntry[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(`sabi-my-payments-${address.toLowerCase()}`)
    return raw ? (JSON.parse(raw) as LocalPaymentEntry[]) : []
  } catch {
    return []
  }
}

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
  // Route billId số đã khoá — chỉ shareCode mới link được vào bill detail.
  shareCode: string | undefined
}

export interface PaymentMade {
  billId: bigint
  amount: bigint
  txHash: `0x${string}`
  blockNumber: bigint
  shareCode: string | undefined
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
  const [firestoreBills, firestorePaymentsRaw] = await Promise.all([
    fetchBillsByOrganizer(addressLower),
    fetchPaymentsByPayer(addressLower),
  ])

  // Gộp thêm lượt trả ghi tạm ở localStorage (xem getLocalPayments) — chỉ
  // thêm lượt CHƯA có trong Firestore (script chưa kịp chạy), dedupe theo txHash.
  const knownTxHashes = new Set(firestorePaymentsRaw.map((p) => p.txHash.toLowerCase()))
  const localPayments = getLocalPayments(addressLower).filter((p) => !knownTxHashes.has(p.txHash.toLowerCase()))
  const firestorePayments: (PaymentDoc & { localWrittenAt?: number })[] = [...firestorePaymentsRaw, ...localPayments]

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
        shareCode: b.shareCode,
      }
    })
    .sort(byBlockDesc)

  // shareCode của billsCreated đã có sẵn (field trong doc vừa fetch ở trên) —
  // chỉ cần fetch thêm cho billId nào của paymentsMade CHƯA có trong đó (bill
  // user trả vào nhưng không phải người tạo).
  const knownShareCodes = new Map(created.map((b) => [b.billId.toString(), b.shareCode]))
  const missingBillIds = Array.from(
    new Set(firestorePayments.map((p) => p.billId).filter((id) => !knownShareCodes.has(id)))
  )
  const extraShareCodes = missingBillIds.length > 0 ? await fetchShareCodesByBillIds(missingBillIds) : {}

  // Lượt trả blockNumber = 0 nghĩa là CHỈ có trong localStorage (xem
  // getLocalPayments), sync-firestore.mjs chưa kịp gán block thật — luôn coi
  // là MỚI NHẤT (vừa xảy ra ngay phiên này), sort với nhau theo localWrittenAt;
  // ngược lại (đã có block thật) sort như cũ theo byBlockDesc. Sort TRƯỚC khi
  // map sang PaymentMade vì localWrittenAt không có trong PaymentMade.
  const byPaymentRecency = (a: PaymentDoc & { localWrittenAt?: number }, b: PaymentDoc & { localWrittenAt?: number }) => {
    const aPending = a.blockNumber === 0
    const bPending = b.blockNumber === 0
    if (aPending && bPending) return (b.localWrittenAt ?? 0) - (a.localWrittenAt ?? 0)
    if (aPending) return -1
    if (bPending) return 1
    return byBlockDesc({ blockNumber: BigInt(a.blockNumber) }, { blockNumber: BigInt(b.blockNumber) })
  }

  const payments: PaymentMade[] = [...firestorePayments]
    .sort(byPaymentRecency)
    .map((p) => ({
      billId: BigInt(p.billId),
      amount: BigInt(p.amount),
      txHash: p.txHash as `0x${string}`,
      blockNumber: BigInt(p.blockNumber),
      shareCode: knownShareCodes.get(p.billId) ?? extraShareCodes[p.billId],
    }))

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

// Badge "ĐANG THU"/"ĐÃ ĐỦ" ở Hồ sơ — đọc TRỰC TIẾP từ chain qua Multicall3
// (batch 1 request cho đúng các bill đang hiện TRÊN TRANG NÀY, xem
// wagmi.ts:16-25 vì sao Multicall3 bắt buộc phải khai báo ở chain config).
//
// Trước đây tính thuần từ CreatedBill (matchedSlotsCount/paidShareCount) —
// 2 field này lấy từ Firestore, chỉ được scripts/sync-firestore.mjs (chạy
// tay) cập nhật, y hệt root cause đã fix ở bill/[id].tsx đêm 05/08/2026 (xem
// memory project-sabi-production-bugfixes-05082026): bill đã trả đủ trên
// chain vẫn hiện "0/4 COLLECTING" cho tới khi ai chạy tay script.
//
// matchedSlotsCount trên contract CHỈ được increment trong paySlot() (xem
// src/bill.sol dòng ~173/242) — payShare() (mode ASSIGNED) không đụng field
// này, luôn = 0 cho bill ASSIGNED. Vậy: OPEN_SLOT (mode 1) đọc thẳng
// getBill() lấy matchedSlotsCount/numSlots; ASSIGNED (mode 0) phải đọc từng
// getShare(billId, shareId) rồi tự đếm paid === true — shareCount (số phần
// tử) dùng luôn giá trị đã biết từ Firestore (CreatedBill.shareCount =
// shares.length, KHÔNG đổi sau khi tạo bill nên không cần đọc lại on-chain),
// chỉ cần gọi getShare cho từng shareId.
export function useBillsProgress(bills: CreatedBill[]): { progress: Record<string, BillProgress>; isLoading: boolean } {
  const { contracts, meta } = useMemo(() => {
    const contractCalls: {
      address: `0x${string}`
      abi: typeof SABI_BILL_ABI
      functionName: string
      args: readonly bigint[]
      // Bắt buộc set rõ per-entry (KHÔNG để mặc định theo chain ví đang connect)
      // — user có thể đang connect Base/Arbitrum Sepolia (trả cross-chain)
      // trong khi bill hiện trên Profile luôn nằm trên Arc. wagmi/viem chuẩn
      // hoá contracts thành đúng dạng { chainId, functionName, args, address }[]
      // này nội bộ (xem readContractsQueryKey trong @wagmi/core), nên set trực
      // tiếp ở đây là đúng cơ chế thật, không phải đoán.
      chainId: number
    }[] = []
    const metaList: { billId: string; kind: 'bill' | 'share' }[] = []
    for (const b of bills) {
      if (b.mode === 1) {
        contractCalls.push({ address: SABI_BILL_ADDRESS, abi: SABI_BILL_ABI, functionName: 'getBill', args: [b.billId], chainId: arcTestnet.id })
        metaList.push({ billId: b.billId.toString(), kind: 'bill' })
      } else {
        for (let shareId = 0; shareId < b.shareCount; shareId++) {
          contractCalls.push({ address: SABI_BILL_ADDRESS, abi: SABI_BILL_ABI, functionName: 'getShare', args: [b.billId, BigInt(shareId)], chainId: arcTestnet.id })
          metaList.push({ billId: b.billId.toString(), kind: 'share' })
        }
      }
    }
    return { contracts: contractCalls, meta: metaList }
  }, [bills])

  const { data, isLoading } = useReadContracts({
    // contracts trộn 2 functionName khác nhau (getBill/getShare) trong 1 mảng —
    // wagmi suy luận type dựa trên literal tuple, mảng build động ở trên
    // không giữ được literal đó (widen thành string) nên ép kiểu tay; entry.result
    // được cast lại đúng shape thật ở dưới (dựa theo ABI, xem SabiBillABI.ts).
    contracts: contracts as any,
    allowFailure: true,
    query: {
      enabled: contracts.length > 0,
      refetchInterval: 25_000,
      // KHÔNG giữ data của bộ contracts TRƯỚC (trang cũ) trong lúc bộ MỚI
      // (trang mới) đang tải — tránh hiện số trang cũ rồi nhảy sang số đúng,
      // đúng loại bug keepPreviousData đã gặp ở matchedSlotsCount đêm trước.
      placeholderData: undefined,
    },
  })

  const progress = useMemo(() => {
    const result: Record<string, BillProgress> = {}
    if (!data) return result
    data.forEach((entry, i) => {
      const m = meta[i]
      if (!m || entry.status !== 'success') return
      if (m.kind === 'bill') {
        const bill = entry.result as { matchedSlotsCount: bigint; numSlots: bigint }
        result[m.billId] = { paidCount: Number(bill.matchedSlotsCount), totalCount: Number(bill.numSlots) }
      } else {
        const share = entry.result as { paid: boolean }
        const prev = result[m.billId] ?? { paidCount: 0, totalCount: 0 }
        result[m.billId] = { paidCount: prev.paidCount + (share.paid ? 1 : 0), totalCount: prev.totalCount + 1 }
      }
    })
    return result
  }, [data, meta])

  return { progress, isLoading: contracts.length > 0 && isLoading }
}
