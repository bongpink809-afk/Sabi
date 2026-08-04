import { CrossChainState } from '../../hooks/useCrossChainPayment'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import type { NextPage, GetServerSideProps } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'next-i18next'
import { serverSideTranslations } from 'next-i18next/serverSideTranslations'
import { formatUnits } from 'viem'
import { sepolia } from 'wagmi/chains'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI, ARC_USDC_ADDRESS, ERC20_ABI, baseSepolia, arbitrumSepolia } from '../../lib/contracts'
import { rpcRetryQueryOptions } from '../../lib/rpcRetry'
import { CrossChainStatusPanel } from '../../components/CrossChainStatus'
import { PaymentChainModal } from '../../components/PaymentChainModal'
import { CrossChainProgressModal } from '../../components/CrossChainProgressModal'
import { PaymentSuccessModal } from '../../components/PaymentSuccessModal'
import { PaymentArcModal } from '../../components/PaymentArcModal'
import { ShareBillSheet } from '../../components/ShareBillSheet'
import { SabiHeader } from '../../components/SabiHeader'
import { arcTestnet } from '../../wagmi'
import { useCrossChainPayment } from '../../hooks/useCrossChainPayment'
import { SourceChain } from '../../hooks/useBurnCrossChain'
import { colors, radius } from '../../styles/theme'
import QRCode from 'qrcode'
import { useBillSync, useProfilesSync, saveSingleShareName } from '../../hooks/useFirebaseSync'
import type { UserFirestoreData, BillContributionDoc, BillShareDoc, BillFirestoreData } from '../../lib/firebase'
import { resolveShareCode } from '../../lib/firebase'
import { useCircleWallet, useCircleContractCall } from '../../contexts/CircleWalletContext'

export const getServerSideProps: GetServerSideProps = async ({ locale }) => ({
  props: { ...(await serverSideTranslations(locale ?? 'en', ['common'])) },
})

// Tên người tham gia chỉ lưu ở frontend (contract không lưu tên, chỉ lưu amount)
// → đọc từ localStorage theo billId, set lúc tạo bill ở create.tsx
type LocalShareNames = Record<number, string>

// 1 lượt góp tiền vào bill OPEN_SLOT — đọc từ event SlotFilled trên chain
interface Contribution {
  payer: `0x${string}`
  amount: bigint
  matched: boolean
  txHash: `0x${string}`
}

// Dùng chung 1 type cho mọi nơi thay vì lặp lại union literal — trước đây
// thêm 'ethereum' phải sửa rải rác 5 chỗ, dễ sót (đúng lỗi vừa xảy ra)
type PayMethod = 'arc' | 'base' | 'arbitrum' | 'ethereum' | 'unsupported'

// Ghép tên gán sẵn cho share (vd "Bông") với tên hồ sơ của người TRẢ thật (vd
// "bông") — nếu chỉ khác hoa/thường thì coi là cùng 1 người, hiện đúng tên hồ
// sơ (giữ nguyên cách viết hoa/thường payer tự đặt) kèm avatar, không ghi thừa
// "Bông (bông trả)". Chỉ khi hai tên thực sự khác nhau mới hiện dạng "X (Y trả)".
function combinePaidName(
  assignedName: string | undefined,
  payerProfileName: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string | undefined {
  if (assignedName && payerProfileName) {
    return assignedName.trim().toLowerCase() === payerProfileName.trim().toLowerCase()
      ? payerProfileName
      : t('bill.combined_name', { assigned: assignedName, payer: payerProfileName })
  }
  return assignedName ?? payerProfileName
}

const BillDetail: NextPage = () => {
  const router = useRouter()
  const { t } = useTranslation('common')
  const { id } = router.query
  const rawId = typeof id === 'string' && id !== '' ? id : undefined

  // Route số cũ (/bill/15) ĐÃ KHOÁ — mọi param URL đều coi là shareCode, luôn
  // resolve qua Firestore, không còn nhánh billId số nào chạy thẳng nữa (xem
  // memory/project_sabi_phase1.md). `undefined` = chưa xác định xong,
  // `null` = shareCode không tồn tại (kể cả khi param gõ tay là 1 số).
  const [resolvedShareCodeBillId, setResolvedShareCodeBillId] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!rawId) return
    setResolvedShareCodeBillId(undefined)
    resolveShareCode(rawId).then(setResolvedShareCodeBillId)
  }, [rawId])

  const billIdStr = resolvedShareCodeBillId ?? undefined
  const billId = billIdStr !== undefined ? BigInt(billIdStr) : undefined
  // Chỉ true khi ĐÃ CHẮC CHẮN không resolve được (không phải đang chờ) — dùng
  // để hiện "not found" ngay. Vì billId số KHÔNG còn nhánh riêng, param dạng
  // số (vd "49") đi qua ĐÚNG 1 đường resolve này như mọi shareCode khác —
  // tự động không lộ khác biệt qua UI giữa "số" và "shareCode sai".
  const shareCodeNotFound = rawId !== undefined && resolvedShareCodeBillId === null

  const { address: connectedAddress } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { chainId: currentChainId } = useAccount()
  const payMethod: PayMethod =
  currentChainId === arcTestnet.id
    ? 'arc'
    : currentChainId === baseSepolia.id
    ? 'base'
    : currentChainId === arbitrumSepolia.id
    ? 'arbitrum'
    : currentChainId === sepolia.id
    ? 'ethereum'
    : 'unsupported'

  // ─── Ví đăng nhập bằng email (Circle) — CHỈ fallback khi CHƯA connect wagmi
  // (MetaMask/WalletConnect), và CHỈ hỗ trợ trả trực tiếp trên Arc (không có khái
  // niệm "đổi chain" như ví thường, nên payMethod luôn ép về 'arc' khi active).
  const { status: circleStatus, walletAddress: circleWalletAddress } = useCircleWallet()
  const isCircleActive = circleStatus === 'ready' && !connectedAddress
  const effectiveAddress = connectedAddress ?? (isCircleActive ? circleWalletAddress ?? undefined : undefined)
  const effectivePayMethod: PayMethod = isCircleActive ? 'arc' : payMethod
  const [shareNames, setShareNames] = useState<LocalShareNames>({})
  const [billTitle, setBillTitle] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<number | null>(null)
  const [showShareSheet, setShowShareSheet] = useState(false)
  // hash đã confirm của từng share — lưu bền để không mất khi F5 lại trang
  const [paidTxHashes, setPaidTxHashes] = useState<Record<number, `0x${string}`>>({})

  // ─── Dữ liệu on-chain của bill — đọc từ Firestore (script scripts/sync-firestore.mjs
  // ghi từ chain), nhận qua đúng subscription useBillSync đã có sẵn cho
  // title/shareNames/slotNames (cùng 1 document bills/{billId}) — không còn gọi RPC.
  const [onchainBill, setOnchainBill] = useState<BillFirestoreData | null>(null)
  const [billLoaded, setBillLoaded] = useState(false)

  // Optimistic overlay — áp ngay khi CHÍNH PHIÊN NÀY vừa trả xong (trực tiếp
  // hoặc cross-chain), không đợi script sync-firestore chạy lại mới thấy cập nhật.
  const [optimisticContributions, setOptimisticContributions] = useState<BillContributionDoc[]>([])
  const [optimisticShares, setOptimisticShares] = useState<Record<number, { payer: string; txHash: `0x${string}` }>>({})

  // Tên tự đặt cho từng địa chỉ ví (dữ liệu cũ, trước khi có avatar/tên hồ sơ) —
  // lưu local theo billId, key là address viết thường. Vẫn giữ đọc để không mất
  // tên đã lưu từ trước, nhưng không còn ghi thêm (xem `profiles` bên dưới).
  const [slotNames, setSlotNames] = useState<Record<string, string>>({})

  // Hồ sơ (avatarUrl, profileName) của từng địa chỉ ví đã trả bill — tự lấy từ
  // Firestore theo địa chỉ payer thật (không cần ai gõ tên tay nữa).
  const [profiles, setProfiles] = useState<Record<string, UserFirestoreData>>({})

  const recordOptimisticSharePaid = (shareId: number, txHash: `0x${string}`) => {
    if (!effectiveAddress) return
    setOptimisticShares((prev) => ({ ...prev, [shareId]: { payer: effectiveAddress.toLowerCase(), txHash } }))
  }
  const recordOptimisticContribution = (amount: bigint, txHash: `0x${string}`) => {
    if (!effectiveAddress) return
    setOptimisticContributions((prev) => {
      if (prev.some((c) => c.txHash.toLowerCase() === txHash.toLowerCase())) return prev
      return [...prev, { payer: effectiveAddress.toLowerCase(), amount: amount.toString(), matched: true, txHash, blockNumber: 0 }]
    })
  }

  // ─── Firebase Firestore realtime sync ─────────────────────────────────────
  // Khi thiết bị khác (PC/Phone) ghi tên bill/tên share, HOẶC script sync-firestore
  // ghi dữ liệu on-chain mới, hook này tự cập nhật state → UI render lại ngay,
  // không cần F5.
  useBillSync(billId !== undefined ? billId.toString() : undefined, (data) => {
    if (data.title) {
      setBillTitle(data.title)
    }
    if (data.shareNames) {
      // Firestore lưu key string ("0","1"), shareNames state dùng number key
      const parsed: LocalShareNames = {}
      Object.entries(data.shareNames).forEach(([k, v]) => { parsed[Number(k)] = v })
      setShareNames((prev) => ({ ...prev, ...parsed }))
    }
    if (data.slotNames) {
      setSlotNames((prev) => ({ ...prev, ...data.slotNames }))
    }
    setOnchainBill(data)
    setBillLoaded(true)
  })

  const mode = onchainBill?.mode === 0 ? 'ASSIGNED' : onchainBill?.mode === 1 ? 'OPEN_SLOT' : undefined

  const bill =
    onchainBill && onchainBill.totalAmount !== undefined
      ? {
          organizer: onchainBill.organizer as `0x${string}`,
          mode: onchainBill.mode!,
          totalAmount: BigInt(onchainBill.totalAmount),
          amountPerSlot: BigInt(onchainBill.amountPerSlot ?? '0'),
          numSlots: BigInt(onchainBill.numSlots ?? 0),
          matchedSlotsCount: BigInt(onchainBill.matchedSlotsCount ?? 0),
          extraReceived: BigInt(onchainBill.extraReceived ?? '0'),
        }
      : undefined

  const shareCount = onchainBill?.shares?.length ?? 0

  // shares/contributions = dữ liệu Firestore ghép với optimistic overlay của phiên này
  const shares: BillShareDoc[] = (onchainBill?.shares ?? []).map((s) => {
    const o = optimisticShares[s.shareId]
    return o ? { ...s, paid: true, payer: o.payer, txHash: o.txHash } : s
  })

  const contributions: Contribution[] = (() => {
    const fromFirestore: Contribution[] = (onchainBill?.contributions ?? []).map((c) => ({
      payer: c.payer as `0x${string}`,
      amount: BigInt(c.amount),
      matched: c.matched,
      txHash: c.txHash as `0x${string}`,
    }))
    const knownHashes = new Set(fromFirestore.map((c) => c.txHash.toLowerCase()))
    const extra: Contribution[] = optimisticContributions
      .filter((c) => !knownHashes.has(c.txHash.toLowerCase()))
      .map((c) => ({ payer: c.payer as `0x${string}`, amount: BigInt(c.amount), matched: c.matched, txHash: c.txHash as `0x${string}` }))
    return [...fromFirestore, ...extra]
  })()

  // Lấy hồ sơ (avatar + tên) của mọi địa chỉ ví đã trả bill này — cả OPEN_SLOT
  // (contributions) lẫn ASSIGNED (shares) — để hoá đơn hiện avatar/tên thật
  // thay vì phải gõ tay.
  const profileAddresses = Array.from(
    new Set([
      ...contributions.map((c) => c.payer),
      ...shares.filter((s): s is BillShareDoc & { payer: string } => !!s.payer).map((s) => s.payer as `0x${string}`),
    ])
  )
  useProfilesSync(profileAddresses, (fetched) => {
    setProfiles((prev) => ({ ...prev, ...fetched }))
  })

  // Hồ sơ (tên) của người tạo bill — dùng cho shareText của nút "Chia sẻ bill".
  useProfilesSync(bill ? [bill.organizer] : [], (fetched) => {
    setProfiles((prev) => ({ ...prev, ...fetched }))
  })

  // Nguồn shareCode dùng cho link chia sẻ/QR/tab header — route số cũ đã khoá
  // (xem đầu component) nên mọi bill vào tới đây chắc chắn đã resolve qua 1
  // shareCode có thật (đã backfill đủ 1 lần, script scripts/backfill-sharecodes.mjs) —
  // không còn cần lazy-backfill tại chỗ như trước.
  const effectiveShareCode = onchainBill?.shareCode

  // Cho phép người xem tự đặt tên nếu creator chưa đặt lúc tạo bill —
  // ghi vào cả localStorage lẫn Firestore để thiết bị khác thấy được ngay
  const updateShareName = (shareId: number, name: string) => {
    if (billId === undefined) return
    const next = { ...shareNames, [shareId]: name }
    setShareNames(next)
    // localStorage (local, instant)
    localStorage.setItem(`sabi-bill-${billId.toString()}-names`, JSON.stringify(next))
    // Firebase Firestore (sync đến mọi thiết bị đang xem bill này)
    saveSingleShareName(billId.toString(), shareId, name, shareNames)
  }

  const isBillLoading = billId !== undefined && !billLoaded

  // ─── Đọc tên người tham gia + hash đã trả trước đó, lưu local lúc tạo/trả bill ──
  useEffect(() => {
    if (billId === undefined) return
    const rawNames = localStorage.getItem(`sabi-bill-${billId.toString()}-names`)
    if (rawNames) {
      try {
        setShareNames(JSON.parse(rawNames))
      } catch {
        // bỏ qua nếu localStorage hỏng, chỉ hiển thị "Phần #i"
      }
    }
    const rawHashes = localStorage.getItem(`sabi-bill-${billId.toString()}-tx`)
    if (rawHashes) {
      try {
        setPaidTxHashes(JSON.parse(rawHashes))
      } catch {
        // bỏ qua nếu hỏng, chỉ là mất link "Xem tx", không ảnh hưởng dữ liệu thật
      }
    }
    const rawSlotNames = localStorage.getItem(`sabi-bill-${billId.toString()}-slotnames`)
    if (rawSlotNames) {
      try {
        setSlotNames(JSON.parse(rawSlotNames))
      } catch {
        // bỏ qua, chỉ hiện địa chỉ ví thay vì tên
      }
    }
    const rawTitle = localStorage.getItem(`sabi-bill-${billId.toString()}-title`)
    if (rawTitle) setBillTitle(rawTitle)
  }, [billId])

    // Khôi phục share đang xử lý dở sau khi F5 — quét localStorage tìm giao dịch cross-chain chưa xong
    useEffect(() => {
      if (billId === undefined) return
      const prefix = `sabi_crosschain_${billId.toString()}_`
      for (const key of Object.keys(localStorage)) {
        if (!key.startsWith(prefix)) continue
        try {
          const saved = JSON.parse(localStorage.getItem(key)!)
          if (['waiting_attestation', 'relaying'].includes(saved.status) && saved.shareId !== undefined) {
            setPayingShareId(saved.shareId)
            break
          }
        } catch {}
      }
    }, [billId])

  // ─── Kiểm tra ví đã approve USDC cho contract SabiBill chưa ──────────────
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: effectiveAddress ? [effectiveAddress, SABI_BILL_ADDRESS] : undefined,
    chainId: arcTestnet.id,
    query: {
      enabled: !!effectiveAddress,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
      ...rpcRetryQueryOptions,
    },
  })

  const { writeContract: approve, data: approveTx, isPending: isApproving, error: approveError, reset: resetApprove } = useWriteContract()
  // chainId cố định Arc — không mặc định theo chain ví đang báo cáo, vì có thể
  // chưa cập nhật đúng (vd vừa trả cross-chain xong, ví còn ở chain nguồn) →
  // hook sẽ đợi receipt trên SAI chain dù tx đã confirm thật trên Arc.
  const { isLoading: isConfirmingApprove, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTx,
    chainId: arcTestnet.id,
  })

  useEffect(() => {
    if (isApproveConfirmed) refetchAllowance()
  }, [isApproveConfirmed, refetchAllowance])

  // Tự động reset về "Approve" nếu sau 45s không có phản hồi từ ví
  // (xử lý trường hợp user đóng popup MetaMask bằng nút X, không bấm Reject)
  useEffect(() => {
    if (!isApproving) return
    const timeout = setTimeout(() => {
      resetApprove()
    }, 45000)
    return () => clearTimeout(timeout)
  }, [isApproving])

  // Reset NGAY khi ví trả lỗi — user bấm Reject hoặc đóng popup bằng X
  // (MetaMask coi đóng popup = reject request). Timeout 45s bên trên
  // giữ lại làm lưới an toàn cho trường hợp ví treo không phản hồi gì.
  useEffect(() => {
    if (approveError) resetApprove()
  }, [approveError, resetApprove])

  // Ba lệnh ghi qua ví Circle — chỉ dùng khi isCircleActive, chạy song song với
  // 3 useWriteContract wagmi bên dưới (không thay thế).
  const circleApprove = useCircleContractCall()
  const circlePayShare = useCircleContractCall()
  const circlePaySlot = useCircleContractCall()

  // Approve đúng số tiền cần trả — MetaMask sẽ hiện đúng số thay vì
  // "115792089..." khi dùng maxUint256. Mỗi lần approve cho 1 giao dịch cụ thể.
  const handleApprove = async (amountToApprove?: bigint) => {
    // Fallback: nếu không có amount cụ thể thì approve tổng bill (vẫn hợp lý)
    const amount = amountToApprove ?? (bill?.totalAmount ?? 2n ** 128n)

    if (isCircleActive) {
      circleApprove.execute({
        contractAddress: ARC_USDC_ADDRESS,
        abiFunctionSignature: 'approve(address,uint256)',
        abiParameters: [SABI_BILL_ADDRESS, amount.toString()],
      })
      return
    }

    if (currentChainId !== arcTestnet.id) {
      await switchChainAsync({ chainId: arcTestnet.id })
    }
    approve({
      address: ARC_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SABI_BILL_ADDRESS, amount],
      chainId: arcTestnet.id,
    })
  }

  const handleCancelApprove = () => {
    resetApprove()
  }

  // Ví cần approve đủ số tiền của giao dịch sắp trả thì mới cho bấm nút Pay thật
  const hasEnoughAllowance = (amountNeeded: bigint) =>
    allowance !== undefined && allowance >= amountNeeded

  const isApprovingNow = isCircleActive ? circleApprove.isPending : (isApproving || isConfirmingApprove)


  const { writeContract: payShare, data: payShareTx, isPending: isPayingShare, error: payShareError } = useWriteContract()
  const { isLoading: isConfirmingShare, isSuccess: isShareConfirmed } = useWaitForTransactionReceipt({
    hash: payShareTx,
    chainId: arcTestnet.id,
  })

  // ─── Ghi: trả tiền vào slot (mode OPEN_SLOT) ──────────────────────────────
  const { writeContract: paySlot, data: paySlotTx, isPending: isPayingSlot, error: paySlotError } = useWriteContract()
  const { isLoading: isConfirmingSlot, isSuccess: isSlotConfirmed } = useWaitForTransactionReceipt({
    hash: paySlotTx,
    chainId: arcTestnet.id,
  })

  // Merge state wagmi/Circle — chỗ dùng ở JSX phía dưới không cần biết đang ở
  // nhánh nào, chỉ đọc đúng 1 bộ giá trị theo isCircleActive.
  const mergedIsPayingShare = isCircleActive ? circlePayShare.isPending : isPayingShare || isConfirmingShare
  const mergedPayShareTx = isCircleActive ? circlePayShare.txHash : payShareTx
  const mergedShareConfirmed = isCircleActive ? circlePayShare.isSuccess : isShareConfirmed
  const mergedPayShareError = isCircleActive ? circlePayShare.error : payShareError

  const mergedIsPayingSlot = isCircleActive ? circlePaySlot.isPending : isPayingSlot || isConfirmingSlot
  const mergedPaySlotTx = isCircleActive ? circlePaySlot.txHash : paySlotTx
  const mergedSlotConfirmed = isCircleActive ? circlePaySlot.isSuccess : isSlotConfirmed
  const mergedPaySlotError = isCircleActive ? circlePaySlot.error : paySlotError

  // Trả trực tiếp xong → ghi ngay vào optimistic state (không đợi script
  // sync-firestore chạy lại mới thấy cập nhật, xem recordOptimisticContribution).
  useEffect(() => {
    if (!mergedSlotConfirmed || !bill || !mergedPaySlotTx) return
    recordOptimisticContribution(bill.amountPerSlot, mergedPaySlotTx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedSlotConfirmed, mergedPaySlotTx])

  // Trả trực tiếp 1 share xong → ghi ngay optimistic (payer = ví đang trả) để
  // hoá đơn hiện đúng địa chỉ thay vì "Phần #n" mãi mãi.
  useEffect(() => {
    if (!mergedShareConfirmed || payingShareId === null || !mergedPayShareTx) return
    recordOptimisticSharePaid(payingShareId, mergedPayShareTx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedShareConfirmed, mergedPayShareTx])

  const handlePayShare = (shareId: number) => {
  if (billId === undefined) return
  setPayingShareId(shareId)
  if (isCircleActive) {
    circlePayShare.execute({
      contractAddress: SABI_BILL_ADDRESS,
      abiFunctionSignature: 'payShare(uint256,uint256)',
      abiParameters: [billId.toString(), shareId.toString()],
    })
    return
  }
  payShare({
    address: SABI_BILL_ADDRESS,
    abi: SABI_BILL_ABI,
    functionName: 'payShare',
    args: [billId, BigInt(shareId)],
    chainId: arcTestnet.id,
  })
}


  const handlePaySlot = () => {
    if (billId === undefined || !bill) return
    if (isCircleActive) {
      circlePaySlot.execute({
        contractAddress: SABI_BILL_ADDRESS,
        abiFunctionSignature: 'paySlot(uint256,uint256)',
        abiParameters: [billId.toString(), bill.amountPerSlot.toString()],
      })
      return
    }
    paySlot({
      address: SABI_BILL_ADDRESS,
      abi: SABI_BILL_ABI,
      functionName: 'paySlot',
      args: [billId, bill.amountPerSlot],
      chainId: arcTestnet.id,
    })
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  // shareCode chắc chắn không resolve được → hiện NGAY, dùng chung UI với `!bill`
  // phía dưới (billId số không tồn tại) — không được để lộ qua thông báo khác
  // nhau việc shareCode có từng trỏ tới billId thật hay không.
  if (shareCodeNotFound) {
    return <NotFoundBill />
  }

  if (billId === undefined) {
    return <Centered>{t('bill.loading_id')}</Centered>
  }

  if (isBillLoading) {
    return <Centered>{t('bill.loading_info')}</Centered>
  }

  if (!bill) {
    return <NotFoundBill />
  }

  // Tiến độ thu tiền — ASSIGNED derive thẳng từ `shares` (đã có sẵn từ Firestore
  // + optimistic overlay), OPEN_SLOT dùng thẳng số liệu có sẵn trên bill + tổng contributions.
  const assignedProgressValues = shares.map((s) => ({ paid: s.paid, amount: BigInt(s.amount) }))
  const progressCount =
    mode === 'ASSIGNED' ? assignedProgressValues.filter((s) => s.paid).length : Number(bill.matchedSlotsCount ?? 0)
  const progressTotalCount = mode === 'ASSIGNED' ? Number(shareCount ?? 0) : Number(bill.numSlots ?? 0)
  const progressAmount =
    mode === 'ASSIGNED'
      ? assignedProgressValues.filter((s) => s.paid).reduce((sum, s) => sum + s.amount, 0n)
      : contributions.reduce((sum, c) => sum + c.amount, 0n)

  // ─── Chia sẻ bill ──────────────────────────────────────────────────────────
  // Ưu tiên native share sheet của OS trên MOBILE THẬT (navigator.share) — sheet
  // tự vẽ (ShareBillSheet) dùng làm fallback (mobile không hỗ trợ navigator.share)
  // hoặc luôn hiện trên desktop. Trước đây chỉ check navigator.share tồn tại, nhưng
  // Windows Edge/Chrome cũng có navigator.share (mở share dialog của Windows, không
  // kiểm soát được icon/thứ tự) → phải check thêm userAgent mobile thật.
  const billUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/bill/${effectiveShareCode ?? billId.toString()}`
  const organizerProfile = profiles[bill.organizer.toLowerCase()]
  const creatorName = organizerProfile?.profileName ?? `${bill.organizer.slice(0, 6)}…${bill.organizer.slice(-4)}`
  const shareText = t('bill.share_text', { creator: creatorName, amount: formatUnits(bill.totalAmount, 6) })
  const isMobileDevice = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

  const handleShareClick = () => {
    if (isMobileDevice && typeof navigator !== 'undefined' && navigator.share) {
      navigator.share({ title: 'Sabi Bill', text: shareText, url: billUrl }).catch(() => {})
    } else {
      setShowShareSheet(true)
    }
  }

  return (
    <div style={wrap}>
      <Head>
        <title>{billTitle ? t('bill.page_title_named', { name: billTitle }) : t('bill.page_title_id', { id: billId.toString() })}</title>
      </Head>

      <SabiHeader currentBillId={billId.toString()} currentShareCode={effectiveShareCode} />

      <main className="sabi-page-main" style={{ padding: '24px 16px 40px' }}>
        <div
          className="sabi-grid-detail"
          style={{
            maxWidth: 1080,
            margin: '0 auto',
          }}
        >
          <div>
            <ReceiptCard
              billId={billId}
              billTitle={billTitle}
              mode={mode}
              shareCount={Number(shareCount ?? 0)}
              shareNames={shareNames}
              shares={shares}
              amountPerSlot={bill.amountPerSlot}
              matchedSlotsCount={Number(bill.matchedSlotsCount ?? 0)}
              numSlots={Number(bill.numSlots ?? 0)}
              totalAmount={bill.totalAmount}
              collectedAmount={progressAmount}
              isWalletConnected={!!effectiveAddress}
              contributions={contributions}
              slotNames={slotNames}
              profiles={profiles}
              billUrl={billUrl}
            />

            <button
              onClick={handleShareClick}
              style={{
                marginTop: 16,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                background: colors.buttonPrimary,
                color: '#fff',
                border: 'none',
                borderRadius: radius.button,
                padding: 16,
                fontSize: 14,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: `0 10px 24px ${colors.shadowColor}`,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 8a3 3 0 100-6 3 3 0 000 6zM6 15a3 3 0 100-6 3 3 0 000 6zm12 6a3 3 0 100-6 3 3 0 000 6zM8.6 13.5l6.8 3.9M15.4 6.6L8.6 10.5" stroke="white" strokeWidth={1.7} strokeLinecap="round" />
              </svg>
              {t('bill.share_button')}
            </button>
          </div>

          <div>
            <ProgressPanel
              paidCount={progressCount}
              totalCount={progressTotalCount}
              paidAmount={progressAmount}
              totalAmount={bill.totalAmount}
              extraNote={
                mode === 'OPEN_SLOT' && bill.extraReceived > 0n
                  ? t('bill.extra_received_note', { amount: formatUnits(bill.extraReceived, 6) })
                  : null
              }
            />

            <div
              style={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.card,
                padding: 20,
                boxShadow: `0 8px 26px ${colors.shadowColor}`,
              }}
            >
              <h3 style={{ fontSize: 16.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 4 }}>
                {t('bill.share_list_title')}
              </h3>
              <p style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 16 }}>
                {mode === 'ASSIGNED' ? t('bill.assigned_hint') : t('bill.openslot_hint')}
              </p>

              {/* Chưa connect ví (wagmi hoặc Circle) → ẩn toàn bộ danh sách share
                  (tên, hash, trạng thái). CỐ Ý lệch spec gốc "ai có link cũng xem
                  được" — chủ dự án đã chốt đổi. */}
              {mode === 'ASSIGNED' && !effectiveAddress && (
                <p style={{ color: colors.textMuted, fontSize: 12 }}>{t('bill.no_contributions')}</p>
              )}

              {mode === 'ASSIGNED' && !!effectiveAddress && (
              <AssignedShares
                billId={billId}
                totalAmount={bill.totalAmount}
                shares={shares}
                shareNames={shareNames}
                profiles={profiles}
                connectedAddress={connectedAddress}
                signerAddress={effectiveAddress}
                onPayDirect={handlePayShare}
                isPaying={mergedIsPayingShare}
                payingShareId={payingShareId}
                paidTxHashes={paidTxHashes}
                onUpdateName={updateShareName}
                hasAllowance={hasEnoughAllowance}
                onApprove={handleApprove}
                onCancelApprove={handleCancelApprove}
                isApproving={isApprovingNow}
                isWalletConnected={!!effectiveAddress}
                payTxHash={mergedPayShareTx}
                paySuccess={mergedShareConfirmed}
                payError={mergedPayShareError}
                payMethod={effectivePayMethod}
                onCrossChainSuccess={recordOptimisticSharePaid}
              />
            )}

              {mode === 'OPEN_SLOT' && (
              <OpenSlotInfo
                billId={billId}
                amountPerSlot={bill.amountPerSlot}
                signerAddress={effectiveAddress}
                onPayDirect={handlePaySlot}
                isPaying={mergedIsPayingSlot}
                hasAllowance={hasEnoughAllowance(bill.amountPerSlot)}
                onApprove={handleApprove}
                isApproving={isApprovingNow}
                isWalletConnected={!!effectiveAddress}
                payTxHash={mergedPaySlotTx}
                paySuccess={mergedSlotConfirmed}
                payError={mergedPaySlotError}
                contributions={contributions}
                isLoadingContributions={!billLoaded}
                slotNames={slotNames}
                profiles={profiles}
                payMethod={effectivePayMethod}
                onCrossChainSuccess={(txHash) => recordOptimisticContribution(bill.amountPerSlot, txHash)}
              />
            )}
            </div>
          </div>
        </div>
      </main>

      {showShareSheet && (
        <ShareBillSheet
          billUrl={billUrl}
          shareText={shareText}
          subtitle={`${formatUnits(bill.totalAmount, 6)} USDC · ${billTitle ?? `Bill #${billId.toString()}`}`}
          isMobile={isMobileDevice}
          onClose={() => setShowShareSheet(false)}
        />
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: colors.textSecondary,
        fontSize: 14,
        textAlign: 'center',
        padding: 16,
        background: colors.background,
      }}
    >
      {children}
    </div>
  )
}

// Dùng chung cho cả 2 case "không tìm thấy bill": shareCode không resolve
// được, VÀ billId hợp lệ nhưng không có dữ liệu thật — cố ý cùng 1 thông báo,
// không phân biệt, tránh lộ qua UI việc shareCode có từng tồn tại hay không.
function NotFoundBill() {
  const { t } = useTranslation('common')
  return (
    <Centered>
      <p style={{ color: colors.danger, marginBottom: 8 }}>{t('bill.not_found')}</p>
      <p style={{ color: colors.textSecondary, fontSize: 14 }}>{t('bill.not_found_hint')}</p>
    </Centered>
  )
}

// Panel "hoá đơn" bên trái — bản đọc (read-only), khớp bố cục sabi-ui-prototype-v8.html
// (.receipt): QR trỏ thẳng vào URL bill thật vì lúc này bill đã tồn tại on-chain,
// khác với ReceiptPreview ở trang tạo bill (lúc đó chưa có billId thật).
function ReceiptCard({
  billId,
  billTitle,
  mode,
  shareCount,
  shareNames,
  shares,
  amountPerSlot,
  matchedSlotsCount,
  numSlots,
  totalAmount,
  collectedAmount,
  isWalletConnected,
  contributions,
  slotNames,
  profiles,
  billUrl,
}: {
  billId: bigint
  billTitle: string | null
  mode: 'ASSIGNED' | 'OPEN_SLOT' | undefined
  shareCount: number
  shareNames: LocalShareNames
  shares: BillShareDoc[]
  amountPerSlot: bigint
  matchedSlotsCount: number
  numSlots: number
  totalAmount: bigint
  collectedAmount: bigint
  isWalletConnected: boolean
  contributions: Contribution[]
  slotNames: Record<string, string>
  profiles: Record<string, UserFirestoreData>
  billUrl: string
}) {
  const { t } = useTranslation('common')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    QRCode.toDataURL(billUrl, {
      width: 118,
      margin: 1,
      color: { dark: '#1B1926', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [billUrl])

  // OPEN_SLOT: hiện đúng từng người đã góp (tên/địa chỉ + số tiền thật), slot
  // còn trống thì hiện dòng "—" gạch ngang — giống hệt hoá đơn ở trang tạo bill,
  // không gộp chung thành 1 dòng "Mỗi slot (x/y)" như trước nữa.
  // Chưa đặt tên nhưng đã trả → hiện địa chỉ ví đã trả (đọc từ event SharePaid)
  // thay vì "Phần #n" mãi mãi — trước đây thiếu vì chưa đọc payer từ event này.
  const shareRows =
    mode === 'ASSIGNED'
      ? Array.from({ length: shareCount }, (_, i) => i).map((shareId) => {
          const shareEntry = shares.find((s) => s.shareId === shareId)
          const payer = shareEntry?.payer
          const payerProfile = payer ? profiles[payer.toLowerCase()] : undefined
          const assignedName = shareNames[shareId]
          const shortAddress = payer ? `${payer.slice(0, 6)}…${payer.slice(-4)}` : undefined
          const name =
            combinePaidName(assignedName, payerProfile?.profileName, t) ?? shortAddress ?? t('bill.share_placeholder', { n: shareId + 1 })
          return {
            name,
            avatarUrl: payerProfile?.avatarUrl,
            paid: !!shareEntry?.paid,
            amount: shareEntry ? BigInt(shareEntry.amount) : undefined,
          }
        })
      : [
          ...contributions.map((c) => {
            const profile = profiles[c.payer.toLowerCase()]
            return {
              name: profile?.profileName ?? slotNames[c.txHash] ?? `${c.payer.slice(0, 6)}…${c.payer.slice(-4)}`,
              avatarUrl: profile?.avatarUrl,
              paid: true,
              amount: c.amount as bigint | undefined,
            }
          }),
          ...Array.from({ length: Math.max(0, numSlots - contributions.length) }, () => ({
            name: '—',
            avatarUrl: undefined as string | undefined,
            paid: false,
            amount: undefined as bigint | undefined,
          })),
        ]

  return (
    <div className="receipt">
      <div style={{ textAlign: 'center', paddingBottom: 12 }}>
        <div style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: 19, color: colors.paperInk }}>SABI</div>
        <div style={{ fontSize: 9.5, color: colors.paperMuted, marginTop: 3, letterSpacing: 1 }}>
          BILL #{billId.toString()} · ARC TESTNET
        </div>
      </div>

      <ReceiptDash />
      <ReceiptRow k="BILL" v={billTitle ?? `Bill #${billId.toString()}`} />
      <ReceiptRow k="CONTRACT" v={`${SABI_BILL_ADDRESS.slice(0, 6)}…${SABI_BILL_ADDRESS.slice(-4)}`} />
      <ReceiptDash />

      {!isWalletConnected ? (
        <p style={{ color: colors.paperMuted, fontSize: 11.5, padding: '4px 0' }}>{t('bill.connect_to_view')}</p>
      ) : (
        shareRows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '7px 0', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
              {r.paid && (
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    flexShrink: 0,
                    overflow: 'hidden',
                    display: 'grid',
                    placeItems: 'center',
                    background: colors.badgeBg,
                    color: colors.badgeText,
                    fontWeight: 700,
                    fontSize: 10,
                    fontFamily: 'sans-serif',
                  }}
                >
                  {r.avatarUrl ? (
                    <img src={r.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    r.name.charAt(0).toUpperCase()
                  )}
                </div>
              )}
              <span style={{ fontWeight: 500, color: colors.paperInk, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
            </div>
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.5,
                padding: '3.5px 7px',
                borderRadius: 6,
                whiteSpace: 'nowrap',
                background: r.paid ? colors.successBg : colors.dangerBg,
                color: r.paid ? colors.success : colors.danger,
              }}
            >
              {r.paid ? t('bill.paid_badge') : t('bill.unpaid_badge')}
            </span>
            <span style={{ fontWeight: 700, color: colors.paperInk, minWidth: 44, textAlign: 'right' }}>
              {r.amount !== undefined ? formatUnits(r.amount, 6) : '—'}
            </span>
          </div>
        ))
      )}

      <ReceiptDash />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0 2px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: colors.paperInk }}>{t('receipt.collected')}</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: colors.paperInk }}>
          {formatUnits(collectedAmount, 6)}{' '}
          <small style={{ fontSize: 11, color: colors.paperMuted, fontWeight: 500 }}>/ {formatUnits(totalAmount, 6)}</small>
        </span>
      </div>
      <ReceiptDash />

      <div style={{ width: 118, height: 118, margin: '12px auto 6px' }}>
        {qrDataUrl && <img src={qrDataUrl} width={118} height={118} alt={t('bill.qr_alt')} />}
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: colors.paperMuted, letterSpacing: 1, marginTop: 7 }}>
        {t('bill.share_link_footer')}
      </div>

      <style jsx>{`
        .receipt {
          background: ${colors.surface};
          border-radius: 4px;
          padding: 24px 22px 18px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          box-shadow: 0 20px 40px ${colors.shadowColor};
          position: relative;
        }
        .receipt::before,
        .receipt::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 10px;
          background-size: 16px 10px;
          background-repeat: repeat-x;
        }
        .receipt::before {
          top: -9px;
          background-image: radial-gradient(circle at 8px 10px, transparent 6px, ${colors.surface} 6.5px);
        }
        .receipt::after {
          bottom: -9px;
          background-image: radial-gradient(circle at 8px 0px, transparent 6px, ${colors.surface} 6.5px);
        }
      `}</style>
    </div>
  )
}

function ReceiptDash() {
  return <hr style={{ border: 'none', borderTop: `1.5px dashed ${colors.borderLight}`, margin: '9px 0' }} />
}

function ReceiptRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 0', gap: 12 }}>
      <span style={{ color: colors.paperMuted }}>{k}</span>
      <span style={{ fontWeight: 600, color: colors.paperInk, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}

// Panel "Tiến độ thu tiền" — bên phải, trên "Danh sách phần trả", khớp bố cục v8.
function ProgressPanel({
  paidCount,
  totalCount,
  paidAmount,
  totalAmount,
  extraNote,
}: {
  paidCount: number
  totalCount: number
  paidAmount: bigint
  totalAmount: bigint
  extraNote: string | null
}) {
  const { t } = useTranslation('common')
  const pct = totalAmount > 0n ? Math.min(100, Number((paidAmount * 10000n) / totalAmount) / 100) : 0
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        padding: 20,
        marginBottom: 20,
        boxShadow: `0 8px 26px ${colors.shadowColor}`,
      }}
    >
      <h3 style={{ fontSize: 16.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 4 }}>{t('bill.progress_title')}</h3>
      <p style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 16 }}>
        {t('bill.progress_hint')}
      </p>
      <div style={{ height: 9, borderRadius: 99, background: colors.backgroundSubtle, overflow: 'hidden', margin: '12px 0 8px' }}>
        <div
          style={{
            height: '100%',
            borderRadius: 99,
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${colors.primary}, ${colors.success})`,
            transition: 'width 0.6s ease',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: colors.textSecondary }}>
        <span>
          <b style={{ color: colors.textPrimary }}>{paidCount}</b>/{totalCount} {t('bill.parts_paid_suffix')}
        </span>
        <span>
          <b style={{ color: colors.textPrimary }}>{formatUnits(paidAmount, 6)}</b> USDC
        </span>
      </div>
      {extraNote && <div style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>{extraNote}</div>}
    </div>
  )
}

// Nhận sẵn `shares` (đã ghép Firestore + optimistic overlay từ component cha)
// thay vì tự multicall getShare — chỉ còn phần HIỂN THỊ cần phân trang.
function AssignedShares({
  billId,
  totalAmount,
  shares,
  shareNames,
  profiles,
  connectedAddress,
  signerAddress,
  onPayDirect,
  isPaying,
  payingShareId,
  paidTxHashes,
  onUpdateName,
  hasAllowance,
  onApprove,
  onCancelApprove,
  isApproving,
  isWalletConnected,
  payTxHash,
  paySuccess,
  payError,
  payMethod,
  onCrossChainSuccess,
}: {
  billId: bigint
  totalAmount: bigint
  shares: BillShareDoc[]
  shareNames: LocalShareNames
  profiles: Record<string, UserFirestoreData>
  connectedAddress: `0x${string}` | undefined
  // Địa chỉ ví đang thực sự trả (wagmi HOẶC ví Circle) — dùng để hiện đúng số dư
  // USDC trong PaymentArcModal khi trả bằng ví Circle (không có wagmi useAccount()).
  signerAddress: `0x${string}` | undefined
  onPayDirect: (shareId: number) => void
  isPaying: boolean
  payingShareId: number | null
  paidTxHashes: Record<number, `0x${string}`>
  onUpdateName: (shareId: number, name: string) => void
  hasAllowance: (amountNeeded: bigint) => boolean
  onApprove: (amount?: bigint) => void
  onCancelApprove: () => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
  payMethod: PayMethod
  onCrossChainSuccess: (shareId: number, txHash: `0x${string}`) => void
}) {
  const { t } = useTranslation('common')
  const shareIds = shares.map((s) => s.shareId)

  // Phân trang danh sách share — 10 phần/trang, quá 10 chuyển trang, giống
  // hệt danh sách người góp bên OPEN_SLOT (OpenSlotInfo)
  const SHARE_PAGE_SIZE = 10
  const [sharePage, setSharePage] = useState(0)
  const totalSharePages = Math.max(1, Math.ceil(shareIds.length / SHARE_PAGE_SIZE))
  const currentSharePage = Math.min(sharePage, totalSharePages - 1)
  const visibleShareIds = shareIds.slice(currentSharePage * SHARE_PAGE_SIZE, currentSharePage * SHARE_PAGE_SIZE + SHARE_PAGE_SIZE)

  return (
    <div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {visibleShareIds.map((shareId) => {
        const isThisRowPaying = payingShareId === shareId
        const savedHash = paidTxHashes[shareId]
        const shareEntry = shares.find((s) => s.shareId === shareId)
        // txHash Firestore luôn có, kể cả share đã trả từ thiết bị/phiên khác
        // (giống contributions.txHash bên OPEN_SLOT) — chỉ dùng để HIỆN link
        // hash, KHÔNG gộp vào displaySuccess (giữ paidDescription trung lập
        // "Đã xác nhận trên Arc" cho share cũ, không đoán bừa là "trả trực tiếp phiên này").
        const displayHash = isThisRowPaying ? payTxHash : savedHash ?? (shareEntry?.txHash ?? undefined)
        const displaySuccess = isThisRowPaying ? paySuccess : !!savedHash
        const share = shareEntry ? { amount: BigInt(shareEntry.amount), paid: shareEntry.paid } : undefined
        const payerAddress = shareEntry?.payer ?? undefined
        const payerProfile = payerAddress ? profiles[payerAddress.toLowerCase()] : undefined
        return (
          <ShareRow
            key={shareId}
            billId={billId}
            totalAmount={totalAmount}
            shareId={shareId}
            share={share}
            name={shareNames[shareId]}
            signerAddress={signerAddress}
            payerProfile={payerProfile}
            onUpdateName={onUpdateName}
            onPayDirect={onPayDirect}
            isPaying={isThisRowPaying && isPaying}
            hasAllowance={hasAllowance}
            onApprove={onApprove}
            onCancelApprove={onCancelApprove}
            isApproving={isApproving}
            isWalletConnected={isWalletConnected}
            payTxHash={displayHash}
            paySuccess={displaySuccess}
            payError={isThisRowPaying ? payError : null}
            payMethod={payMethod}
            onCrossChainSuccess={(txHash) => onCrossChainSuccess(shareId, txHash)}
          />
        )
      })}
    </div>

    {totalSharePages > 1 && (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <button
          onClick={() => setSharePage((p) => Math.max(0, p - 1))}
          disabled={currentSharePage === 0}
          style={{
            background: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            color: currentSharePage === 0 ? colors.textMuted : colors.textSecondary,
            cursor: currentSharePage === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {t('bill.prev_page')}
        </button>
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          {t('bill.page_indicator', { current: currentSharePage + 1, total: totalSharePages })}
        </span>
        <button
          onClick={() => setSharePage((p) => Math.min(totalSharePages - 1, p + 1))}
          disabled={currentSharePage >= totalSharePages - 1}
          style={{
            background: 'none',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 13,
            fontWeight: 600,
            color: currentSharePage >= totalSharePages - 1 ? colors.textMuted : colors.textSecondary,
            cursor: currentSharePage >= totalSharePages - 1 ? 'not-allowed' : 'pointer',
          }}
        >
          {t('bill.next_page')}
        </button>
      </div>
    )}
    </div>
  )
}

function ShareRow({
  billId,
  totalAmount,
  shareId,
  share,
  name,
  signerAddress,
  payerProfile,
  onUpdateName,
  onPayDirect,
  isPaying,
  hasAllowance,
  onApprove,
  onCancelApprove,
  isApproving,
  isWalletConnected,
  payTxHash,
  paySuccess,
  payError,
  payMethod,
  onCrossChainSuccess,
}: {
  billId: bigint
  totalAmount: bigint
  shareId: number
  share: { amount: bigint; paid: boolean } | undefined
  name: string | undefined
  signerAddress: `0x${string}` | undefined
  payerProfile: UserFirestoreData | undefined
  onUpdateName: (shareId: number, name: string) => void
  onPayDirect: (shareId: number) => void
  isPaying: boolean
  hasAllowance: (amountNeeded: bigint) => boolean
  onApprove: (amount?: bigint) => void
  onCancelApprove: () => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
  payMethod: PayMethod
  onCrossChainSuccess: (txHash: `0x${string}`) => void
}) {
  const { t } = useTranslation('common')
  // Auto-fill tên từ profile name nếu người dùng đã đặt tên hồ sơ
  // — tránh phải nhập tên lại mỗi lần trả bill
  const { address: currentAddress } = useAccount()
  const [nameDraft, setNameDraft] = useState('')
  useEffect(() => {
    if (!currentAddress) return
    // Chỉ auto-fill nếu ô tên vẫn còn trống — không ghi đè tên đã gõ
    setNameDraft((prev) => {
      if (prev) return prev
      return localStorage.getItem(`sabi-profile-name-${currentAddress.toLowerCase()}`) ?? ''
    })
  }, [currentAddress])

  // Mỗi ShareRow tự quản lý trạng thái cross-chain của CHÍNH NÓ — độc lập hoàn toàn với share khác
  const { state: ccState, start: startCrossChainPay, reset: resetCrossChainPay, isDelayed: ccIsDelayed } = useCrossChainPayment(billId, shareId)

  // Modal 1 (chọn chain) — chỉ hiện khi user bấm trả cross-chain, chưa ký gì
  const [showChainModal, setShowChainModal] = useState(false)
  // Modal trả trực tiếp trên Arc — chỉ mở khi payMethod === 'arc'
  const [showArcModal, setShowArcModal] = useState(false)
  // Modal 3 (success) — tự capture hash lúc ccState chuyển success, vì
  // ccState có thể tự reset về idle ngay sau đó (effect bên dưới) mà modal
  // success vẫn phải đứng yên tới khi user bấm "Xem bill". Giữ Modal 2 thêm
  // 700ms sau khi success để log kịp hiện dòng cuối + coin mờ dần trước khi
  // chuyển sang Modal 3, giống hệt choreography trong prototype.
  const [successTxHash, setSuccessTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [holdProgressModal, setHoldProgressModal] = useState(false)
  // successStartedRef chặn chạy lại lần 2 (KHÔNG phải để huỷ timer) — timer
  // KHÔNG được đặt trong cleanup của effect phụ thuộc ccState.status, vì effect
  // reset ccState về 'idle' ở nơi khác sẽ khiến effect này chạy lại và tự huỷ
  // timer đang chờ trước khi kịp bắn (đúng bug làm modal success không bao giờ hiện).
  const successStartedRef = useRef(false)
  useEffect(() => {
    if (ccState.status === 'success' && ccState.relayTxHash && !successStartedRef.current) {
      successStartedRef.current = true
      setHoldProgressModal(true)
      const capturedHash = ccState.relayTxHash
      setTimeout(() => {
        setSuccessTxHash(capturedHash)
        setHoldProgressModal(false)
      }, 700)
    }
  }, [ccState.status, ccState.relayTxHash])

  // Trả cross-chain xong → ghi ngay optimistic ở component cha (payer = ví
  // đang trả), không cần đợi script sync-firestore chạy lại.
  useEffect(() => {
    if (ccState.status !== 'success' || !ccState.relayTxHash) return
    onCrossChainSuccess(ccState.relayTxHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccState.status])

  // `share` đã thấy "paid" (qua optimistic overlay ở component cha, effect
  // trên) → panel "Đang cập nhật danh sách..." hết nhiệm vụ lấp gap, tự đóng
  // thay vì treo mãi — khớp cơ chế OPEN_SLOT (OpenSlotInfo) đã có sẵn.
  useEffect(() => {
    if (ccState.status === 'success' && share?.paid) {
      resetCrossChainPay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccState.status, share?.paid])

  const isPaid = share ? share.paid || paySuccess || ccState.status === 'success' : false

  if (!share) return null

  const isCrossChainBusy = !['idle', 'success', 'error'].includes(ccState.status)
  const amount = formatUnits(share.amount, 6)
  // So allowance theo TỔNG bill (không phải riêng amount của share này) — cùng
  // 1 mức allowance áp dụng cho mọi share trong bill, để mọi hàng cùng hiện
  // "Pay" hoặc cùng hiện "Approve" tại 1 thời điểm, không lẫn lộn theo số tiền
  // từng share (vd share 1 USDC "Pay" trong khi share 10 USDC "Approve" dù
  // cùng 1 allowance thật).
  const needsApprove = isWalletConnected && !hasAllowance(totalAmount)

  const saveName = () => {
    if (!nameDraft.trim()) return
    onUpdateName(shareId, nameDraft.trim())
  }

  const handleClickPay = async () => {
    if (payMethod === 'unsupported') {
      alert(t('bill.unsupported_chain_alert'))
      return
    }
    if (payMethod !== 'arc') {
      setShowChainModal(true)
      return
    }
    setShowArcModal(true)
  }

  const handleConfirmChain = (chain: SourceChain) => {
    setShowChainModal(false)
    startCrossChainPay(share.amount, chain)
  }

  const handleRetryCrossChain = () => {
    const source = ccState.sourceChain ?? (payMethod !== 'arc' && payMethod !== 'unsupported' ? payMethod : 'base')
    startCrossChainPay(share.amount, source)
  }

  // Hash + mô tả "trả ở đâu" — chỉ chắc chắn được trong PHIÊN NÀY (ccState/paySuccess
  // sống trong React state, không đọc lại được sau khi refresh). Share đã trả từ trước
  // (share.paid=true từ chain, không có dữ liệu phiên) → mô tả trung lập, không đoán
  // bừa là "trực tiếp" vì có thể sai (thật ra trả qua cross-chain ở phiên khác).
  const chainDisplayNames = { base: 'Base Sepolia', arbitrum: 'Arbitrum Sepolia', ethereum: 'Ethereum Sepolia' } as const
  const resolvedTxHash = ccState.status === 'success' ? ccState.relayTxHash : payTxHash
  const paidDescription =
    ccState.status === 'success' && ccState.sourceChain
      ? t('bill.paid_crosschain_from', { chain: chainDisplayNames[ccState.sourceChain] })
      : paySuccess
      ? t('bill.paid_direct_arc')
      : t('bill.paid_confirmed_arc')

  // payerProfile chỉ có khi share đã có payer thật (đã trả) — chưa trả thì
  // không đoán, giữ nguyên tên gán sẵn (hoặc input nhập tay nếu chưa có tên).
  const displayName = isPaid ? combinePaidName(name, payerProfile?.profileName, t) : name

  return (
    <div
      style={{
        padding: '13px 14px',
        borderRadius: 14,
        background: isPaid ? `linear-gradient(90deg, ${colors.successBg}, ${colors.surface})` : colors.surface,
        border: `1px solid ${isPaid ? 'rgba(23,162,104,.4)' : colors.border}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: '50%',
          flexShrink: 0,
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          background: colors.badgeBg,
          color: colors.badgeText,
          fontWeight: 700,
          fontSize: 13,
          fontFamily: 'sans-serif',
        }}
      >
        {isPaid && payerProfile?.avatarUrl ? (
          <img src={payerProfile.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          (displayName || '?').charAt(0).toUpperCase()
        )}
      </div>

      <div style={{ flex: 1, minWidth: 140 }}>
        {displayName ? (
          <div style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{displayName}</div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={t('bill.name_placeholder_optional')}
              style={{
                fontSize: 13,
                padding: '6px 10px',
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                outline: 'none',
                flex: 1,
                minWidth: 0,
              }}
            />
            <button
              onClick={saveName}
              disabled={!nameDraft.trim()}
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: colors.primary,
                background: 'none',
                border: `1px solid ${colors.primary}`,
                borderRadius: 6,
                padding: '0 10px',
                cursor: nameDraft.trim() ? 'pointer' : 'not-allowed',
                opacity: nameDraft.trim() ? 1 : 0.5,
              }}
            >
              {t('bill.save')}
            </button>
          </div>
        )}
        {isPaid ? (
          <>
            <div style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{paidDescription}</div>
            {resolvedTxHash && (
<a
                href={`https://testnet.arcscan.app/tx/${resolvedTxHash}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'block',
                  color: colors.primary,
                  fontSize: 10,
                  textDecoration: 'underline',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  marginTop: 1,
                }}
              >
                {resolvedTxHash.slice(0, 8)}…{resolvedTxHash.slice(-6)} ↗
              </a>
            )}
          </>
        ) : (
          <div style={{ color: colors.danger, fontSize: 12, fontWeight: 600, marginTop: 2 }}>{t('bill.unpaid_label')}</div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontWeight: 700, fontSize: 14, color: colors.textPrimary, whiteSpace: 'nowrap' }}>
          {amount}
        </span>

        {isPaid ? (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              flexShrink: 0,
              display: 'grid',
              placeItems: 'center',
              background: colors.successBg,
              color: colors.success,
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            ✓
          </div>
        ) : needsApprove ? (
          <button
            onClick={() => onApprove(totalAmount)}
            disabled={isApproving}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: isApproving ? colors.textMuted : colors.buttonPrimary,
              border: 'none',
              borderRadius: radius.button,
              padding: '8px 14px',
              cursor: isApproving ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isApproving ? t('bill.processing_short') : t('bill.allow_usdc')}
          </button>
        ) : (
          <button
            onClick={handleClickPay}
            disabled={isPaying || !isWalletConnected || isCrossChainBusy}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: isPaying || !isWalletConnected || isCrossChainBusy ? colors.textMuted : colors.buttonPrimary,
              border: 'none',
              borderRadius: radius.button,
              padding: '8px 14px',
              cursor: isPaying || !isWalletConnected || isCrossChainBusy ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isCrossChainBusy ? t('bill.processing_short') : isPaying ? t('bill.processing_short') : t('bill.pay_button')}
          </button>
        )}
      </div>
      </div>

      {ccState.status === 'error' && (
        <CrossChainStatusPanel state={ccState} onRetry={handleRetryCrossChain} onDismiss={resetCrossChainPay} isDelayed={ccIsDelayed} />
      )}

      {showChainModal && (
        <PaymentChainModal
          amount={share.amount}
          payerName={displayName || t('paymentModal.chain.default_payer_name')}
          onCancel={() => setShowChainModal(false)}
          onConfirm={handleConfirmChain}
        />
      )}
      {(isCrossChainBusy || holdProgressModal) && <CrossChainProgressModal state={ccState} isDelayed={ccIsDelayed} />}
      {successTxHash && <PaymentSuccessModal txHash={successTxHash} onClose={() => setSuccessTxHash(undefined)} />}
      {showArcModal && (
        <PaymentArcModal
          amount={share.amount}
          payerName={displayName || t('paymentModal.chain.default_payer_name')}
          functionName="payShare"
          onClose={() => setShowArcModal(false)}
          onPay={() => onPayDirect(shareId)}
          isPaying={isPaying}
          payTxHash={payTxHash}
          paySuccess={paySuccess}
          payError={payError}
          payerAddress={signerAddress}
        />
      )}
    </div>
  )
}

function OpenSlotInfo({
  billId,
  amountPerSlot,
  signerAddress,
  onPayDirect,
  isPaying,
  hasAllowance,
  onApprove,
  isApproving,
  isWalletConnected,
  payTxHash,
  paySuccess,
  payError,
  contributions,
  isLoadingContributions,
  slotNames,
  profiles,
  payMethod,
  onCrossChainSuccess,
}: {
  billId: bigint
  amountPerSlot: bigint
  signerAddress: `0x${string}` | undefined
  onPayDirect: () => void
  isPaying: boolean
  hasAllowance: boolean
  onApprove: (amount?: bigint) => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
  contributions: Contribution[]
  isLoadingContributions: boolean
  slotNames: Record<string, string>
  profiles: Record<string, UserFirestoreData>
  payMethod: PayMethod
  onCrossChainSuccess: (txHash: `0x${string}`) => void
}) {
  const { t } = useTranslation('common')
  const amount = formatUnits(amountPerSlot, 6)

  const needsApprove = isWalletConnected && !hasAllowance

  // Phân trang danh sách người đã góp — 10 người/trang, quá 10 chuyển trang
  // thay vì cuộn dài hoặc "xem thêm"
  const CONTRIB_PAGE_SIZE = 10
  const [contribPage, setContribPage] = useState(0)
  const totalContribPages = Math.max(1, Math.ceil(contributions.length / CONTRIB_PAGE_SIZE))
  const currentContribPage = Math.min(contribPage, totalContribPages - 1)
  const visibleContributions = contributions.slice(
    currentContribPage * CONTRIB_PAGE_SIZE,
    currentContribPage * CONTRIB_PAGE_SIZE + CONTRIB_PAGE_SIZE
  )

  const chainDisplayNames = { base: 'Base Sepolia', arbitrum: 'Arbitrum Sepolia', ethereum: 'Ethereum Sepolia' } as const

  // OPEN_SLOT dùng shareId: undefined — đúng thiết kế gốc, không gắn 1 người/1 share cố định
  const { state: ccState, start: startCrossChainPay, reset: resetCrossChainPay, isDelayed: ccIsDelayed } = useCrossChainPayment(billId, undefined)
  const isCrossChainBusy = !['idle', 'success', 'error'].includes(ccState.status)

  const [showChainModal, setShowChainModal] = useState(false)
  const [showArcModal, setShowArcModal] = useState(false)
  // Giữ Modal 2 thêm 700ms sau khi success để log kịp hiện dòng cuối + coin
  // mờ dần trước khi chuyển sang Modal 3 — xem ShareRow ở trên cho lý do đầy đủ.
  const [successTxHash, setSuccessTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [holdProgressModal, setHoldProgressModal] = useState(false)
  // successStartedRef chặn chạy lại lần 2 (KHÔNG phải để huỷ timer) — timer
  // KHÔNG được đặt trong cleanup của effect phụ thuộc ccState.status, vì effect
  // reset ccState về 'idle' ở nơi khác sẽ khiến effect này chạy lại và tự huỷ
  // timer đang chờ trước khi kịp bắn (đúng bug làm modal success không bao giờ hiện).
  const successStartedRef = useRef(false)
  useEffect(() => {
    if (ccState.status === 'success' && ccState.relayTxHash && !successStartedRef.current) {
      successStartedRef.current = true
      setHoldProgressModal(true)
      const capturedHash = ccState.relayTxHash
      setTimeout(() => {
        setSuccessTxHash(capturedHash)
        setHoldProgressModal(false)
      }, 700)
    }
  }, [ccState.status, ccState.relayTxHash])

  // Relay xong → ghi ngay optimistic ở component cha, không cần đợi script
  // sync-firestore chạy lại mới thấy dòng góp tiền mới.
  useEffect(() => {
    if (ccState.status !== 'success' || !ccState.relayTxHash) return
    onCrossChainSuccess(ccState.relayTxHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccState.status])

  // Hash relay đã hiện thành dòng trong danh sách → panel "Đang cập nhật danh sách..."
  // hết nhiệm vụ lấp gap, tự đóng thay vì treo "đang cập nhật" mãi
  useEffect(() => {
    if (
      ccState.status === 'success' &&
      ccState.relayTxHash &&
      contributions.some((c) => c.txHash.toLowerCase() === ccState.relayTxHash!.toLowerCase())
    ) {
      resetCrossChainPay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccState.status, ccState.relayTxHash, contributions])

  const handleClickPay = async () => {
    if (payMethod === 'unsupported') {
      alert(t('bill.unsupported_chain_alert_contribute'))
      return
    }
    if (payMethod !== 'arc') {
      setShowChainModal(true)
      return
    }
    setShowArcModal(true)
  }

  const handleConfirmChain = (chain: SourceChain) => {
    setShowChainModal(false)
    startCrossChainPay(amountPerSlot, chain)
  }

  const handleRetryCrossChain = () => {
    const source = ccState.sourceChain ?? (payMethod !== 'arc' && payMethod !== 'unsupported' ? payMethod : 'base')
    startCrossChainPay(amountPerSlot, source)
  }

  return (
    <div>
      {needsApprove ? (
        <>
          <button
            onClick={() => onApprove(amountPerSlot)}
            disabled={isApproving}
            style={{
              width: '100%',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: isApproving ? colors.textMuted : colors.buttonPrimary,
              border: 'none',
              borderRadius: radius.button,
              padding: '12px',
              cursor: isApproving ? 'not-allowed' : 'pointer',
            }}
          >
            {isApproving ? t('bill.processing_short') : t('bill.allow_sabi_usdc')}
          </button>
          <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
            {t('bill.approve_once_note')}
          </p>
        </>
      ) : (
          isWalletConnected && (
            <>
              <button
                onClick={handleClickPay}
                disabled={isPaying || isCrossChainBusy}
                style={{
                  width: '100%',
                  fontSize: 14,
                  fontWeight: 600,
                  color: '#fff',
                  background: isPaying || isCrossChainBusy ? colors.textMuted : colors.buttonPrimary,
                  border: 'none',
                  borderRadius: radius.button,
                  padding: '12px',
                  cursor: isPaying || isCrossChainBusy ? 'not-allowed' : 'pointer',
                }}
              >
                {isCrossChainBusy ? t('bill.processing_short') : isPaying ? t('bill.processing_short') : t('bill.contribute_button', { amount })}
              </button>
            </>
          )
        )}

      {isWalletConnected && ccState.status === 'error' && (
        <CrossChainStatusPanel
          state={ccState}
          onRetry={handleRetryCrossChain}
          onDismiss={resetCrossChainPay}
          isDelayed={ccIsDelayed}
        />
      )}

      {showChainModal && (
        <PaymentChainModal
          amount={amountPerSlot}
          payerName={t('paymentModal.chain.default_payer_name')}
          onCancel={() => setShowChainModal(false)}
          onConfirm={handleConfirmChain}
        />
      )}
      {(isCrossChainBusy || holdProgressModal) && (
        <CrossChainProgressModal state={ccState} isDelayed={ccIsDelayed} onCancelBurning={resetCrossChainPay} />
      )}
      {successTxHash && <PaymentSuccessModal txHash={successTxHash} onClose={() => setSuccessTxHash(undefined)} />}
      {showArcModal && (
        <PaymentArcModal
          amount={amountPerSlot}
          payerName={t('paymentModal.chain.default_payer_name')}
          functionName="paySlot"
          onClose={() => setShowArcModal(false)}
          onPay={() => onPayDirect()}
          isPaying={isPaying}
          payTxHash={payTxHash}
          paySuccess={paySuccess}
          payError={payError}
          payerAddress={signerAddress}
        />
      )}

      {/* Danh sách người đã góp — đọc từ event SlotFilled trên chain.
          Chưa connect ví → ẩn hết danh sách + hash, chỉ hiện "Chưa có ai góp tiền."
          (CỐ Ý lệch spec gốc — chủ dự án đã chốt). */}
      <div style={{ marginTop: 20 }}>
        <div style={{ color: colors.textSecondary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {t('bill.contributors_title')} {isWalletConnected && contributions.length > 0 && `(${contributions.length})`}
        </div>

        {!isWalletConnected && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>{t('bill.no_contributions')}</p>
        )}

        {isWalletConnected && isLoadingContributions && contributions.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>{t('bill.loading_short')}</p>
        )}

        {isWalletConnected && !isLoadingContributions && contributions.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>{t('bill.no_contributions')}</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isWalletConnected && visibleContributions.map((c, i) => {
            const profile = profiles[c.payer.toLowerCase()]
            const shortAddress = `${c.payer.slice(0, 6)}...${c.payer.slice(-4)}`
            // Tên/avatar lấy tự động từ hồ sơ Firestore của chính người trả —
            // không cần gõ tay nữa. slotNames giữ lại làm fallback cho dữ liệu
            // cũ (trước khi có bước này), người trả chưa có hồ sơ thì hiện địa chỉ ví.
            const displayName = profile?.profileName ?? slotNames[c.txHash]
            const avatarUrl = profile?.avatarUrl

            // Biết chính xác "trả ở đâu" CHỈ khi đúng là giao dịch vừa hoàn tất trong
            // phiên này (so khớp hash với ccState/payTxHash đang sống trong React state) —
            // các dòng góp cũ (của mình từ trước hoặc của người khác) không có dữ liệu
            // này nên hiện mô tả trung lập, không đoán bừa.
            const isThisSessionCrossChain =
              ccState.status === 'success' && ccState.relayTxHash?.toLowerCase() === c.txHash.toLowerCase()
            const isThisSessionDirect = paySuccess && payTxHash?.toLowerCase() === c.txHash.toLowerCase()
            const description =
              isThisSessionCrossChain && ccState.sourceChain
                ? t('bill.paid_crosschain_from', { chain: chainDisplayNames[ccState.sourceChain] })
                : isThisSessionDirect
                ? t('bill.paid_direct_arc')
                : t('bill.paid_confirmed_arc')

            return (
              <div
                key={`${c.txHash}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '13px 14px',
                  borderRadius: 14,
                  flexWrap: 'wrap',
                  background: `linear-gradient(90deg, ${colors.successBg}, ${colors.surface})`,
                  border: '1px solid rgba(23,162,104,.4)',
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    flexShrink: 0,
                    display: 'grid',
                    placeItems: 'center',
                    background: colors.badgeBg,
                    color: colors.badgeText,
                    fontWeight: 700,
                    fontSize: 13,
                    fontFamily: 'sans-serif',
                    overflow: 'hidden',
                  }}
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    (displayName || shortAddress).charAt(0).toUpperCase()
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>
                    {displayName ?? shortAddress}
                    {!c.matched && (
                      <span style={{ color: colors.warning, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>{t('bill.amount_mismatch_note')}</span>
                    )}
                  </div>
                  <div style={{ color: colors.textSecondary, fontSize: 11, marginTop: 2 }}>{description}</div>
<a
                    href={`https://testnet.arcscan.app/tx/${c.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      color: colors.primary,
                      fontSize: 10,
                      textDecoration: 'underline',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      marginTop: 1,
                    }}
                  >
                    {c.txHash.slice(0, 8)}…{c.txHash.slice(-6)} ↗
                  </a>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontWeight: 700, fontSize: 14, color: colors.textPrimary, whiteSpace: 'nowrap' }}>
                    {formatUnits(c.amount, 6)}
                  </span>
                  <div
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      background: colors.successBg,
                      color: colors.success,
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    ✓
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {isWalletConnected && totalContribPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <button
              onClick={() => setContribPage((p) => Math.max(0, p - 1))}
              disabled={currentContribPage === 0}
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                color: currentContribPage === 0 ? colors.textMuted : colors.textSecondary,
                cursor: currentContribPage === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {t('bill.prev_page')}
            </button>
            <span style={{ fontSize: 12, color: colors.textSecondary }}>
              {t('bill.page_indicator', { current: currentContribPage + 1, total: totalContribPages })}
            </span>
            <button
              onClick={() => setContribPage((p) => Math.min(totalContribPages - 1, p + 1))}
              disabled={currentContribPage >= totalContribPages - 1}
              style={{
                background: 'none',
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '6px 12px',
                fontSize: 13,
                fontWeight: 600,
                color: currentContribPage >= totalContribPages - 1 ? colors.textMuted : colors.textSecondary,
                cursor: currentContribPage >= totalContribPages - 1 ? 'not-allowed' : 'pointer',
              }}
            >
              {t('bill.next_page')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { minHeight: '100vh', fontFamily: 'sans-serif', background: colors.background }

export default BillDetail
