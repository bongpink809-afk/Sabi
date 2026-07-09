import { CrossChainState } from '../../hooks/useCrossChainPayment'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useSwitchChain } from 'wagmi'
import type { NextPage, GetServerSideProps } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'next-i18next'
import { serverSideTranslations } from 'next-i18next/serverSideTranslations'
import { formatUnits, HttpRequestError } from 'viem'
import { sepolia } from 'wagmi/chains'
import { SABI_BILL_ADDRESS, SABI_BILL_DEPLOY_BLOCK, SABI_BILL_ABI, ARC_USDC_ADDRESS, ERC20_ABI, baseSepolia, arbitrumSepolia } from '../../lib/contracts'
import { CrossChainStatusPanel } from '../../components/CrossChainStatus'
import { SabiHeader } from '../../components/SabiHeader'
import { arcTestnet } from '../../wagmi'
import { useCrossChainPayment } from '../../hooks/useCrossChainPayment'
import { colors, radius } from '../../styles/theme'
import QRCode from 'qrcode'
import { useBillSync, useProfilesSync, saveSingleShareName } from '../../hooks/useFirebaseSync'
import type { UserFirestoreData } from '../../lib/firebase'

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

// RPC public Arc Testnet rate-limit (429) khi nhiều chunk getLogs bắn song
// song cùng lúc — retry với backoff thay vì để cả danh sách góp tiền/share
// đã trả rớt trắng chỉ vì 1 chunk bị chặn thoáng qua
async function withRetry429<T>(fn: () => Promise<T>, retries = 3, delayMs = 600): Promise<T> {
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

const BillDetail: NextPage = () => {
  const router = useRouter()
  const { t } = useTranslation('common')
  const { id } = router.query
  const billId = typeof id === 'string' && id !== '' ? BigInt(id) : undefined

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
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const [shareNames, setShareNames] = useState<LocalShareNames>({})
  const [billTitle, setBillTitle] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<number | null>(null)
  // hash đã confirm của từng share — lưu bền để không mất khi F5 lại trang
  const [paidTxHashes, setPaidTxHashes] = useState<Record<number, `0x${string}`>>({})

  // Trạng thái trả/amount của từng share (mode ASSIGNED) — ShareRow tự đọc chain
  // rồi "báo cáo" lên đây để tính tiến độ tổng (panel "Tiến độ thu tiền"),
  // tránh phải đọc lại toàn bộ share 1 lần nữa ở component cha.
  const [shareProgress, setShareProgress] = useState<Record<number, { paid: boolean; amount: bigint }>>({})
  const reportShareProgress = (shareId: number, paid: boolean, amount: bigint) => {
    setShareProgress((prev) => {
      const cur = prev[shareId]
      if (cur && cur.paid === paid && cur.amount === amount) return prev
      return { ...prev, [shareId]: { paid, amount } }
    })
  }

  // ─── Danh sách người đã góp (mode OPEN_SLOT) — đọc từ event log trên chain ──
  const [contributions, setContributions] = useState<Contribution[]>([])
  const [isLoadingContributions, setIsLoadingContributions] = useState(false)
  // Tên tự đặt cho từng địa chỉ ví (dữ liệu cũ, trước khi có avatar/tên hồ sơ) —
  // lưu local theo billId, key là address viết thường. Vẫn giữ đọc để không mất
  // tên đã lưu từ trước, nhưng không còn ghi thêm (xem `profiles` bên dưới).
  const [slotNames, setSlotNames] = useState<Record<string, string>>({})

  // Hồ sơ (avatarUrl, profileName) của từng địa chỉ ví đã trả bill — tự lấy từ
  // Firestore theo địa chỉ payer thật (không cần ai gõ tên tay nữa).
  const [profiles, setProfiles] = useState<Record<string, UserFirestoreData>>({})

  const fetchContributions = async () => {
    if (billId === undefined || !publicClient) return
    setIsLoadingContributions(true)
    try {
      const latestBlock = await publicClient.getBlockNumber()
      const CHUNK_SIZE = 5000n//PC Arc Testnet giới hạn số block/lần gọi — quét cả chain 1 lần bị lỗi 413
      const MAX_CHUNKS = 50 // giới hạn an toàn — không quét quá 100k block về trước, tránh treo nếu chain đã chạy lâu

      // Tính trước toàn bộ khoảng [fromBlock,toBlock] của từng chunk rồi bắn
      // SONG SONG bằng Promise.all — trước đây await tuần tự từng chunk một,
      // nếu cần nhiều chunk sẽ cộng dồn độ trễ round-trip (đúng nguyên nhân "hiện chậm").
      const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
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

      const chunkResults = await Promise.all(
        ranges.map(({ fromBlock, toBlock }) =>
          withRetry429(() =>
            publicClient.getContractEvents({
              address: SABI_BILL_ADDRESS,
              abi: SABI_BILL_ABI,
              eventName: 'SlotFilled',
              args: { billId },
              fromBlock,
              toBlock,
            })
          )
        )
      )
      const allLogs = chunkResults.flat()

      const list: Contribution[] = allLogs.map((log: any) => ({
        payer: log.args.payer,
        amount: log.args.amount,
        matched: log.args.matched,
        txHash: log.transactionHash,
      }))
      setContributions(list)
    } catch (err) {
      console.error('Lỗi đọc lịch sử góp tiền:', err)
    } finally {
      setIsLoadingContributions(false)
    }
  }

  // ─── Địa chỉ ví đã trả từng share (mode ASSIGNED) — đọc từ event SharePaid,
  // event này CÓ payer (contract có lưu, chỉ là trước đây frontend chưa đọc) —
  // dùng để hiện ví thay cho "Phần #n" ở hoá đơn khi share đã trả nhưng chưa đặt tên.
  const [sharePayers, setSharePayers] = useState<Record<number, `0x${string}`>>({})
  // Hash tx đã trả từng share — đọc thẳng từ event log (giống contributions.txHash
  // bên OPEN_SLOT), nên luôn có kể cả khi share được trả từ thiết bị/phiên khác,
  // không phụ thuộc state phiên hiện tại (payTxHash chỉ có nếu trả ngay trong phiên này).
  const [sharePaidTxHashes, setSharePaidTxHashes] = useState<Record<number, `0x${string}`>>({})

  const fetchSharePayers = async () => {
    if (billId === undefined || !publicClient) return
    try {
      const latestBlock = await publicClient.getBlockNumber()
      const CHUNK_SIZE = 5000n
      const MAX_CHUNKS = 50

      const ranges: { fromBlock: bigint; toBlock: bigint }[] = []
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

      const chunkResults = await Promise.all(
        ranges.map(({ fromBlock, toBlock }) =>
          withRetry429(() =>
            publicClient.getContractEvents({
              address: SABI_BILL_ADDRESS,
              abi: SABI_BILL_ABI,
              eventName: 'SharePaid',
              args: { billId },
              fromBlock,
              toBlock,
            })
          )
        )
      )
      const allLogs = chunkResults.flat()
      const payerMap: Record<number, `0x${string}`> = {}
      const hashMap: Record<number, `0x${string}`> = {}
      allLogs.forEach((log: any) => {
        const shareId = Number(log.args.shareId)
        payerMap[shareId] = log.args.payer
        hashMap[shareId] = log.transactionHash
      })
      setSharePayers(payerMap)
      setSharePaidTxHashes(hashMap)
    } catch (err) {
      console.error('Lỗi đọc địa chỉ ví đã trả share:', err)
    }
  }

  // ─── Firebase Firestore realtime sync ─────────────────────────────────────
  // Khi thiết bị khác (PC/Phone) ghi tên bill hoặc tên share lên Firestore,
  // hook này tự cập nhật localStorage + setState → UI render lại ngay.
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
  })

  // Lấy hồ sơ (avatar + tên) của mọi địa chỉ ví đã trả bill này — cả OPEN_SLOT
  // (contributions) lẫn ASSIGNED (sharePayers) — để hoá đơn hiện avatar/tên
  // thật thay vì phải gõ tay.
  const profileAddresses = Array.from(
    new Set([...contributions.map((c) => c.payer), ...Object.values(sharePayers)])
  )
  useProfilesSync(profileAddresses, (fetched) => {
    setProfiles((prev) => ({ ...prev, ...fetched }))
  })

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

  // ─── Đọc thông tin bill ───────────────────────────────────────────────────
  const {
    data: bill,
    isLoading: isBillLoading,
    error: billError,
    refetch: refetchBill,
  } = useReadContract({
    address: SABI_BILL_ADDRESS,
    abi: SABI_BILL_ABI,
    functionName: 'getBill',
    args: billId !== undefined ? [billId] : undefined,
    chainId: arcTestnet.id,
    query: {
      enabled: billId !== undefined,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  })

  // bill.mode: 0 = ASSIGNED, 1 = OPEN_SLOT (theo enum BillMode trong SabiBill.sol)
  const mode = bill ? (bill.mode === 0 ? 'ASSIGNED' : 'OPEN_SLOT') : undefined

  // shareCount KHÔNG nằm trong struct Bill — nó là mapping riêng: shareCount(billId)
  const { data: shareCount } = useReadContract({
    address: SABI_BILL_ADDRESS,
    abi: SABI_BILL_ABI,
    functionName: 'shareCount',
    args: billId !== undefined ? [billId] : undefined,
    chainId: arcTestnet.id,
    query: {
      enabled: billId !== undefined && mode === 'ASSIGNED',
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  })

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

    fetchContributions()
    fetchSharePayers()
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
    args: connectedAddress ? [connectedAddress, SABI_BILL_ADDRESS] : undefined,
    chainId: arcTestnet.id,
    query: {
      enabled: !!connectedAddress,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
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

  // Approve đúng số tiền cần trả — MetaMask sẽ hiện đúng số thay vì
  // "115792089..." khi dùng maxUint256. Mỗi lần approve cho 1 giao dịch cụ thể.
  const handleApprove = async (amountToApprove?: bigint) => {
    if (currentChainId !== arcTestnet.id) {
      await switchChainAsync({ chainId: arcTestnet.id })
    }
    // Fallback: nếu không có amount cụ thể thì approve tổng bill (vẫn hợp lý)
    const amount = amountToApprove ?? (bill?.totalAmount ?? 2n ** 128n)
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

  const isApprovingNow = isApproving || isConfirmingApprove


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

  // Event SlotFilled có thể chưa kịp index ngay lúc tx vừa confirm (RPC lag) —
  // thử lại 1 lần sau 6s, giống hệt cơ chế đã dùng cho cross-chain, để không
  // phải F5 mới thấy dòng góp tiền mới.
  useEffect(() => {
    if (!isSlotConfirmed) return
    refetchBill()
    fetchContributions()
    const retry = setTimeout(fetchContributions, 6000)
    return () => clearTimeout(retry)
  }, [isSlotConfirmed])

  // Trả trực tiếp 1 share xong → kéo lại ví đã trả (SharePaid) để hoá đơn hiện
  // đúng địa chỉ thay vì "Phần #n" mãi mãi. Cùng lý do RPC lag như trên — thử
  // lại 1 lần sau 6s.
  useEffect(() => {
    if (!isShareConfirmed) return
    fetchSharePayers()
    const retry = setTimeout(fetchSharePayers, 6000)
    return () => clearTimeout(retry)
  }, [isShareConfirmed])

  const handlePayShare = (shareId: number) => {
  if (billId === undefined) return
  setPayingShareId(shareId)
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
    paySlot({
      address: SABI_BILL_ADDRESS,
      abi: SABI_BILL_ABI,
      functionName: 'paySlot',
      args: [billId, bill.amountPerSlot],
      chainId: arcTestnet.id,
    })
  }

  // ─── Render ────────────────────────────────────────────────────────────────
  if (billId === undefined) {
    return <Centered>{t('bill.loading_id')}</Centered>
  }

  if (isBillLoading) {
    return <Centered>{t('bill.loading_info')}</Centered>
  }

  if (billError || !bill) {
    return (
      <Centered>
        <p style={{ color: colors.danger, marginBottom: 8 }}>{t('bill.not_found')}</p>
        <p style={{ color: colors.textSecondary, fontSize: 14 }}>
          {t('bill.not_found_hint')}
        </p>
      </Centered>
    )
  }

  // Tiến độ thu tiền — ASSIGNED dùng state "nâng lên" từ từng ShareRow (đọc chain
  // riêng từng share), OPEN_SLOT dùng thẳng số liệu có sẵn trên bill + tổng contributions.
  const assignedProgressValues = Object.values(shareProgress)
  const progressCount =
    mode === 'ASSIGNED' ? assignedProgressValues.filter((s) => s.paid).length : Number(bill.matchedSlotsCount ?? 0)
  const progressTotalCount = mode === 'ASSIGNED' ? Number(shareCount ?? 0) : Number(bill.numSlots ?? 0)
  const progressAmount =
    mode === 'ASSIGNED'
      ? assignedProgressValues.filter((s) => s.paid).reduce((sum, s) => sum + s.amount, 0n)
      : contributions.reduce((sum, c) => sum + c.amount, 0n)

  return (
    <div style={wrap}>
      <Head>
        <title>{billTitle ? t('bill.page_title_named', { name: billTitle }) : t('bill.page_title_id', { id: billId.toString() })}</title>
      </Head>

      <SabiHeader currentBillId={billId.toString()} />

      <main className="sabi-page-main" style={{ padding: '24px 16px 40px' }}>
        <div
          className="sabi-grid-detail"
          style={{
            maxWidth: 1080,
            margin: '0 auto',
          }}
        >
          <ReceiptCard
            billId={billId}
            billTitle={billTitle}
            mode={mode}
            shareCount={Number(shareCount ?? 0)}
            shareNames={shareNames}
            shareProgress={shareProgress}
            amountPerSlot={bill.amountPerSlot}
            matchedSlotsCount={Number(bill.matchedSlotsCount ?? 0)}
            numSlots={Number(bill.numSlots ?? 0)}
            totalAmount={bill.totalAmount}
            collectedAmount={progressAmount}
            isWalletConnected={!!connectedAddress}
            contributions={contributions}
            slotNames={slotNames}
            sharePayers={sharePayers}
            profiles={profiles}
          />

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

              {/* Chưa connect ví → ẩn toàn bộ danh sách share (tên, hash, trạng thái).
                  CỐ Ý lệch spec gốc "ai có link cũng xem được" — chủ dự án đã chốt đổi. */}
              {mode === 'ASSIGNED' && !connectedAddress && (
                <p style={{ color: colors.textMuted, fontSize: 12 }}>{t('bill.no_contributions')}</p>
              )}

              {mode === 'ASSIGNED' && !!connectedAddress && (
              <AssignedShares
                billId={billId}
                shareCount={Number(shareCount ?? 0)}
                shareNames={shareNames}
                sharePayers={sharePayers}
                sharePaidTxHashes={sharePaidTxHashes}
                profiles={profiles}
                connectedAddress={connectedAddress}
                onPayDirect={handlePayShare}
                isPaying={isPayingShare || isConfirmingShare}
                payingShareId={payingShareId}
                paidTxHashes={paidTxHashes}
                onUpdateName={updateShareName}
                hasAllowance={hasEnoughAllowance}
                onApprove={handleApprove}
                onCancelApprove={handleCancelApprove}
                isApproving={isApprovingNow}
                isWalletConnected={!!connectedAddress}
                payTxHash={payShareTx}
                paySuccess={isShareConfirmed}
                payError={payShareError}
                payMethod={payMethod}
                onShareLoaded={reportShareProgress}
                onCrossChainSuccess={fetchSharePayers}
              />
            )}

              {mode === 'OPEN_SLOT' && (
              <OpenSlotInfo
                billId={billId}
                amountPerSlot={bill.amountPerSlot}
                onPayDirect={handlePaySlot}
                isPaying={isPayingSlot || isConfirmingSlot}
                hasAllowance={hasEnoughAllowance(bill.amountPerSlot)}
                onApprove={handleApprove}
                isApproving={isApprovingNow}
                isWalletConnected={!!connectedAddress}
                payTxHash={paySlotTx}
                paySuccess={isSlotConfirmed}
                payError={paySlotError}
                contributions={contributions}
                isLoadingContributions={isLoadingContributions}
                slotNames={slotNames}
                profiles={profiles}
                payMethod={payMethod}
                onCrossChainSuccess={() => {
                  refetchBill()
                  fetchContributions()
                }}
              />
            )}
            </div>
          </div>
        </div>
      </main>
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

// Panel "hoá đơn" bên trái — bản đọc (read-only), khớp bố cục sabi-ui-prototype-v8.html
// (.receipt): QR trỏ thẳng vào URL bill thật vì lúc này bill đã tồn tại on-chain,
// khác với ReceiptPreview ở trang tạo bill (lúc đó chưa có billId thật).
function ReceiptCard({
  billId,
  billTitle,
  mode,
  shareCount,
  shareNames,
  shareProgress,
  amountPerSlot,
  matchedSlotsCount,
  numSlots,
  totalAmount,
  collectedAmount,
  isWalletConnected,
  contributions,
  slotNames,
  sharePayers,
  profiles,
}: {
  billId: bigint
  billTitle: string | null
  mode: 'ASSIGNED' | 'OPEN_SLOT' | undefined
  shareCount: number
  shareNames: LocalShareNames
  shareProgress: Record<number, { paid: boolean; amount: bigint }>
  amountPerSlot: bigint
  matchedSlotsCount: number
  numSlots: number
  totalAmount: bigint
  collectedAmount: bigint
  isWalletConnected: boolean
  contributions: Contribution[]
  slotNames: Record<string, string>
  sharePayers: Record<number, `0x${string}`>
  profiles: Record<string, UserFirestoreData>
}) {
  const { t } = useTranslation('common')
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/bill/${billId.toString()}`, {
      width: 118,
      margin: 1,
      color: { dark: '#1B1926', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [billId])

  // OPEN_SLOT: hiện đúng từng người đã góp (tên/địa chỉ + số tiền thật), slot
  // còn trống thì hiện dòng "—" gạch ngang — giống hệt hoá đơn ở trang tạo bill,
  // không gộp chung thành 1 dòng "Mỗi slot (x/y)" như trước nữa.
  // Chưa đặt tên nhưng đã trả → hiện địa chỉ ví đã trả (đọc từ event SharePaid)
  // thay vì "Phần #n" mãi mãi — trước đây thiếu vì chưa đọc payer từ event này.
  const shareRows =
    mode === 'ASSIGNED'
      ? Array.from({ length: shareCount }, (_, i) => i).map((shareId) => {
          const payer = sharePayers[shareId]
          const payerProfile = payer ? profiles[payer.toLowerCase()] : undefined
          const assignedName = shareNames[shareId]
          const shortAddress = payer ? `${payer.slice(0, 6)}…${payer.slice(-4)}` : undefined
          const name =
            combinePaidName(assignedName, payerProfile?.profileName, t) ?? shortAddress ?? t('bill.share_placeholder', { n: shareId + 1 })
          return {
            name,
            avatarUrl: payerProfile?.avatarUrl,
            paid: !!shareProgress[shareId]?.paid,
            amount: shareProgress[shareId]?.amount,
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

// Đọc TẤT CẢ share bằng 1 lần multicall (Multicall3 có thật trên Arc Testnet,
// đã verify qua eth_getCode) thay vì mỗi ShareRow tự gọi getShare riêng —
// trước đây N share = N round-trip RPC nối tiếp, vừa chậm vừa khiến receipt
// bên trái "chớp" sai trạng thái CHƯA TRẢ lúc đầu vì các share load lệch nhịp nhau.
function AssignedShares({
  billId,
  shareCount,
  shareNames,
  sharePayers,
  sharePaidTxHashes,
  profiles,
  connectedAddress,
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
  onShareLoaded,
  onCrossChainSuccess,
}: {
  billId: bigint
  shareCount: number
  shareNames: LocalShareNames
  sharePayers: Record<number, `0x${string}`>
  sharePaidTxHashes: Record<number, `0x${string}`>
  profiles: Record<string, UserFirestoreData>
  connectedAddress: `0x${string}` | undefined
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
  onShareLoaded: (shareId: number, paid: boolean, amount: bigint) => void
  onCrossChainSuccess: () => void
}) {
  const { t } = useTranslation('common')
  const shareIds = Array.from({ length: shareCount }, (_, i) => i)

  // Multicall đọc TẤT CẢ share (cần đủ dữ liệu cho "Tiến độ thu tiền" tổng ở
  // component cha) — chỉ phần HIỂN THỊ mới phân trang, không phải phần đọc chain.
  const { data: sharesData, refetch: refetchAllShares } = useReadContracts({
    contracts: shareIds.map((shareId) => ({
      address: SABI_BILL_ADDRESS,
      abi: SABI_BILL_ABI,
      functionName: 'getShare',
      chainId: arcTestnet.id,
      args: [billId, BigInt(shareId)] as const,
    })),
    query: {
      enabled: shareCount > 0,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  })

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
        // sharePaidTxHashes đọc thẳng từ event log SharePaid nên luôn có hash,
        // kể cả share đã trả từ thiết bị/phiên khác (giống contributions.txHash
        // bên OPEN_SLOT) — chỉ dùng để HIỆN link hash, KHÔNG gộp vào displaySuccess
        // (giữ paidDescription trung lập "Đã xác nhận trên Arc" cho share cũ,
        // không đoán bừa là "trả trực tiếp phiên này").
        const displayHash = isThisRowPaying ? payTxHash : savedHash ?? sharePaidTxHashes[shareId]
        const displaySuccess = isThisRowPaying ? paySuccess : !!savedHash
        const shareResult = sharesData?.[shareId]
        const share =
          shareResult && shareResult.status === 'success'
            ? (shareResult.result as unknown as { amount: bigint; paid: boolean })
            : undefined
        const payerAddress = sharePayers[shareId]
        const payerProfile = payerAddress ? profiles[payerAddress.toLowerCase()] : undefined
        return (
          <ShareRow
            key={shareId}
            billId={billId}
            shareId={shareId}
            share={share}
            refetchShare={refetchAllShares}
            name={shareNames[shareId]}
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
            onShareLoaded={onShareLoaded}
            onCrossChainSuccess={onCrossChainSuccess}
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
  shareId,
  share,
  refetchShare,
  name,
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
  onShareLoaded,
  onCrossChainSuccess,
}: {
  billId: bigint
  shareId: number
  share: { amount: bigint; paid: boolean } | undefined
  refetchShare: () => void
  name: string | undefined
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
  onShareLoaded: (shareId: number, paid: boolean, amount: bigint) => void
  onCrossChainSuccess: () => void
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

  useEffect(() => {
    if (paySuccess || ccState.status === 'success') refetchShare()
  }, [paySuccess, ccState.status])

  // Trả cross-chain xong → kéo lại ví đã trả (SharePaid) ở component cha để hoá
  // đơn hiện đúng địa chỉ — event có thể index trễ vài giây nên thử lại 1 lần sau 6s,
  // giống hệt cơ chế đã dùng cho danh sách người góp bên OPEN_SLOT.
  useEffect(() => {
    if (ccState.status !== 'success') return
    onCrossChainSuccess()
    const retry = setTimeout(onCrossChainSuccess, 6000)
    return () => clearTimeout(retry)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccState.status])

  // Share đã đọc lại từ chain thấy "paid" (qua refetchShare ở effect trên) →
  // panel "Đang cập nhật danh sách..." hết nhiệm vụ lấp gap, tự đóng thay vì
  // treo mãi — thiếu bước này nên trước đây panel không bao giờ tự tắt, khác
  // với OPEN_SLOT (OpenSlotInfo) đã có sẵn cơ chế tương đương.
  useEffect(() => {
    if (ccState.status === 'success' && share?.paid) {
      resetCrossChainPay()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ccState.status, share?.paid])

  const isPaid = share ? share.paid || paySuccess || ccState.status === 'success' : false

  // Báo cáo trạng thái lên component cha để tính "Tiến độ thu tiền" tổng —
  // không đọc lại chain, chỉ tái dùng dữ liệu ShareRow đã đọc sẵn.
  useEffect(() => {
    if (share) onShareLoaded(shareId, isPaid, share.amount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share?.amount, isPaid])

  if (!share) return null

  const isCrossChainBusy = !['idle', 'success', 'error'].includes(ccState.status)
  const amount = formatUnits(share.amount, 6)
  const needsApprove = isWalletConnected && !hasAllowance(share.amount)

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
      await startCrossChainPay(share.amount, payMethod)
      return
    }
    onPayDirect(shareId)
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
            onClick={() => onApprove(share?.amount)}
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

      {isPaying && !payTxHash && (
        <p style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>{t('bill.waiting_wallet_sign')}</p>
      )}
      {payTxHash && !paySuccess && !payError && (
        <p style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>{t('bill.sent_waiting_confirm')}</p>
      )}
      {payError && (
        <p style={{ color: colors.danger, fontSize: 11, marginTop: 6 }}>{t('bill.error_prefix', { message: payError.message.split('\n')[0] })}</p>
      )}
      {ccState.status !== 'idle' && (
        <CrossChainStatusPanel state={ccState} onRetry={handleRetryCrossChain} onDismiss={resetCrossChainPay} isDelayed={ccIsDelayed} />
      )}
    </div>
  )
}

function OpenSlotInfo({
  billId,
  amountPerSlot,
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
  onCrossChainSuccess: () => void
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

  // Relay xong → kéo lại bill + danh sách góp (trước đây chỉ refetch khi trả trực tiếp,
  // trả cross-chain phải F5 mới thấy dòng mới). Refetch lại 1 lần sau 6s phòng RPC index trễ.
  useEffect(() => {
    if (ccState.status !== 'success') return
    onCrossChainSuccess()
    const retry = setTimeout(onCrossChainSuccess, 6000)
    return () => clearTimeout(retry)
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
      await startCrossChainPay(amountPerSlot, payMethod)
      return
    }
    onPayDirect()
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
              {/* Nút Huỷ — chỉ hiện khi đang chờ ký burn (state burning), cho phép
                  user thoát khỏi trạng thái kẹt khi mobile wallet đóng popup không trả error */}
              {ccState.status === 'burning' && (
                <button
                  onClick={resetCrossChainPay}
                  style={{
                    width: '100%',
                    marginTop: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: colors.textSecondary,
                    background: 'none',
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.button,
                    padding: '10px',
                    cursor: 'pointer',
                  }}
                >
                  {t('bill.cancel_tx')}
                </button>
              )}
            </>
          )
        )}

      {/* Trạng thái giao dịch — để không ai phải đoán mò như lúc test lần đầu */}
      {isWalletConnected && (
        <>
          {isPaying && !payTxHash && (
            <p style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              {t('bill.waiting_wallet_sign')}
            </p>
          )}
          {payTxHash && !paySuccess && !payError && (
            <p style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              {t('bill.sent_waiting_confirm_chain')}
            </p>
          )}
          {paySuccess && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <p style={{ color: colors.successText, fontSize: 12, fontWeight: 600 }}>{t('bill.contribute_success')}</p>
              {payTxHash && (
<a
                  href={`https://testnet.arcscan.app/tx/${payTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: colors.primary,
                    fontSize: 11,
                    textDecoration: 'underline',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  }}
                >
                  {t('bill.view_tx', { hash: `${payTxHash.slice(0, 10)}...${payTxHash.slice(-8)}` })}
                </a>
              )}
            </div>
          )}
          {payError && (
            <p style={{ color: colors.danger, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              {t('bill.error_prefix', { message: payError.message.split('\n')[0] })}
            </p>
          )}
        </>
      )}
      {isWalletConnected && ccState.status !== 'idle' && (
        <CrossChainStatusPanel
          state={ccState}
          onRetry={handleRetryCrossChain}
          onDismiss={resetCrossChainPay}
          isDelayed={ccIsDelayed}
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
