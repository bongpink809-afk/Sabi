import { CrossChainState } from '../../hooks/useCrossChainPayment'
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useSwitchChain } from 'wagmi'
import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { sepolia } from 'wagmi/chains'
import { SABI_BILL_ADDRESS, SABI_BILL_DEPLOY_BLOCK, SABI_BILL_ABI, ARC_USDC_ADDRESS, ERC20_ABI, baseSepolia, arbitrumSepolia } from '../../lib/contracts'
import { CrossChainStatusPanel } from '../../components/CrossChainStatus'
import { SabiHeader } from '../../components/SabiHeader'
import { arcTestnet } from '../../wagmi'
import { useCrossChainPayment } from '../../hooks/useCrossChainPayment'
import { colors, radius } from '../../styles/theme'
import QRCode from 'qrcode'

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

const BillDetail: NextPage = () => {
  const router = useRouter()
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
  // Tên tự đặt cho từng địa chỉ ví — lưu local theo billId, key là address viết thường
  const [slotNames, setSlotNames] = useState<Record<string, string>>({})
  const [contributorName, setContributorName] = useState('')
  const [pendingContributorName, setPendingContributorName] = useState('')



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
      const allLogs = chunkResults.flat()
      const map: Record<number, `0x${string}`> = {}
      allLogs.forEach((log: any) => {
        map[Number(log.args.shareId)] = log.args.payer
      })
      setSharePayers(map)
    } catch (err) {
      console.error('Lỗi đọc địa chỉ ví đã trả share:', err)
    }
  }

  // Cho phép người xem tự đặt tên nếu creator chưa đặt lúc tạo bill —
  // lưu local trên máy người đó (mỗi người xem trang này lưu riêng, không đồng bộ nhau)
  const updateShareName = (shareId: number, name: string) => {
    if (billId === undefined) return
    const next = { ...shareNames, [shareId]: name }
    setShareNames(next)
    localStorage.setItem(`sabi-bill-${billId.toString()}-names`, JSON.stringify(next))
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
    query: { enabled: billId !== undefined },
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
    query: { enabled: billId !== undefined && mode === 'ASSIGNED' },
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
    query: { enabled: !!connectedAddress },
  })

  const { writeContract: approve, data: approveTx, isPending: isApproving, error: approveError, reset: resetApprove } = useWriteContract()
  const { isLoading: isConfirmingApprove, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTx,
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

  // Approve số lớn (max uint256) 1 lần — khỏi phải approve lại mỗi lần trả tiền
    const handleApprove = async () => {
    if (currentChainId !== arcTestnet.id) {
      await switchChainAsync({ chainId: arcTestnet.id })
    }
    approve({
      address: ARC_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SABI_BILL_ADDRESS, 2n ** 256n - 1n],
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
  })

  // ─── Ghi: trả tiền vào slot (mode OPEN_SLOT) ──────────────────────────────
  const { writeContract: paySlot, data: paySlotTx, isPending: isPayingSlot, error: paySlotError } = useWriteContract()
  const { isLoading: isConfirmingSlot, isSuccess: isSlotConfirmed } = useWaitForTransactionReceipt({
    hash: paySlotTx,
  })

  // Lưu tên người góp theo txHash — dùng chung cho cả trả trực tiếp (paySlotTx)
  // lẫn trả cross-chain (relayTxHash), tránh lặp lại logic ghi localStorage 2 nơi
  const saveSlotName = (txHash: `0x${string}`, name: string) => {
    if (!name.trim() || billId === undefined) return
    const next = { ...slotNames, [txHash]: name.trim() }
    setSlotNames(next)
    localStorage.setItem(`sabi-bill-${billId.toString()}-slotnames`, JSON.stringify(next))
  }

  useEffect(() => {
    if (isSlotConfirmed && paySlotTx) {
      refetchBill()
      fetchContributions()
      if (pendingContributorName) saveSlotName(paySlotTx, pendingContributorName)
    }
  }, [isSlotConfirmed])



  useEffect(() => {
    if (isSlotConfirmed) {
      refetchBill()
      fetchContributions()
    }
  }, [isSlotConfirmed])

  // Trả trực tiếp 1 share xong → kéo lại ví đã trả (SharePaid) để hoá đơn hiện
  // đúng địa chỉ thay vì "Phần #n" mãi mãi
  useEffect(() => {
    if (isShareConfirmed) fetchSharePayers()
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
    setPendingContributorName(contributorName.trim())
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
    return <Centered>Đang tải billId từ URL...</Centered>
  }

  if (isBillLoading) {
    return <Centered>Đang tải thông tin bill...</Centered>
  }

  if (billError || !bill) {
    return (
      <Centered>
        <p style={{ color: colors.danger, marginBottom: 8 }}>Không tìm thấy bill này.</p>
        <p style={{ color: colors.textSecondary, fontSize: 14 }}>
          Kiểm tra lại link — billId có thể sai hoặc bill chưa được tạo.
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
        <title>{billTitle ? `${billTitle} — Sabi` : `Bill #${billId.toString()} — Sabi`}</title>
      </Head>

      <SabiHeader currentBillId={billId.toString()} />

      <main style={{ padding: '24px 16px 40px' }}>
        <div
          style={{
            maxWidth: 1080,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '400px 1fr',
            gap: 30,
            alignItems: 'start',
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
          />

          <div>
            <ProgressPanel
              paidCount={progressCount}
              totalCount={progressTotalCount}
              paidAmount={progressAmount}
              totalAmount={bill.totalAmount}
              extraNote={
                mode === 'OPEN_SLOT' && bill.extraReceived > 0n
                  ? `Có ${formatUnits(bill.extraReceived, 6)} USDC góp lệch số tiền chuẩn`
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
                Danh sách phần trả
              </h3>
              <p style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 16 }}>
                {mode === 'ASSIGNED' ? 'Tick xanh = có tx hash thật trên Arc' : 'Ai cũng góp được — cập nhật theo on-chain'}
              </p>

              {/* Chưa connect ví → ẩn toàn bộ danh sách share (tên, hash, trạng thái).
                  CỐ Ý lệch spec gốc "ai có link cũng xem được" — chủ dự án đã chốt đổi. */}
              {mode === 'ASSIGNED' && !connectedAddress && (
                <p style={{ color: colors.textMuted, fontSize: 12 }}>Chưa có ai góp tiền.</p>
              )}

              {mode === 'ASSIGNED' && !!connectedAddress && (
              <AssignedShares
                billId={billId}
                shareCount={Number(shareCount ?? 0)}
                shareNames={shareNames}
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
                contributorName={contributorName}
                onChangeContributorName={setContributorName}
                payMethod={payMethod}
                onCrossChainSuccess={() => {
                  refetchBill()
                  fetchContributions()
                }}
                onSaveContributorName={saveSlotName}
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
}) {
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
          return {
            name:
              shareNames[shareId] ??
              (payer ? `${payer.slice(0, 6)}…${payer.slice(-4)}` : `Phần #${shareId + 1}`),
            paid: !!shareProgress[shareId]?.paid,
            amount: shareProgress[shareId]?.amount,
          }
        })
      : [
          ...contributions.map((c) => ({
            name: slotNames[c.txHash] ?? `${c.payer.slice(0, 6)}…${c.payer.slice(-4)}`,
            paid: true,
            amount: c.amount as bigint | undefined,
          })),
          ...Array.from({ length: Math.max(0, numSlots - contributions.length) }, () => ({
            name: '—',
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
        <p style={{ color: colors.paperMuted, fontSize: 11.5, padding: '4px 0' }}>Kết nối ví để xem chi tiết người góp.</p>
      ) : (
        shareRows.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, padding: '7px 0', gap: 10 }}>
            <span style={{ flex: 1, fontWeight: 500, color: colors.paperInk, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
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
              {r.paid ? 'ĐÃ TRẢ' : 'CHƯA TRẢ'}
            </span>
            <span style={{ fontWeight: 700, color: colors.paperInk, minWidth: 44, textAlign: 'right' }}>
              {r.amount !== undefined ? formatUnits(r.amount, 6) : '—'}
            </span>
          </div>
        ))
      )}

      <ReceiptDash />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0 2px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: colors.paperInk }}>ĐÃ THU</span>
        <span style={{ fontSize: 20, fontWeight: 700, color: colors.paperInk }}>
          {formatUnits(collectedAmount, 6)}{' '}
          <small style={{ fontSize: 11, color: colors.paperMuted, fontWeight: 500 }}>/ {formatUnits(totalAmount, 6)}</small>
        </span>
      </div>
      <ReceiptDash />

      <div style={{ width: 118, height: 118, margin: '12px auto 6px' }}>
        {qrDataUrl && <img src={qrDataUrl} width={118} height={118} alt="QR mở trang bill" />}
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: colors.paperMuted, letterSpacing: 1, marginTop: 7 }}>
        SHARE LINK — KẾT NỐI VÍ ĐỂ XEM CHI TIẾT NGƯỜI GÓP
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
      <h3 style={{ fontSize: 16.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 4 }}>Tiến độ thu tiền</h3>
      <p style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 16 }}>
        Đếm on-chain — chỉ tính giao dịch đã confirm trên Arc
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
          <b style={{ color: colors.textPrimary }}>{paidCount}</b>/{totalCount} phần đã trả
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
  connectedAddress: `0x${string}` | undefined
  onPayDirect: (shareId: number) => void
  isPaying: boolean
  payingShareId: number | null
  paidTxHashes: Record<number, `0x${string}`>
  onUpdateName: (shareId: number, name: string) => void
  hasAllowance: (amountNeeded: bigint) => boolean
  onApprove: () => void
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
    query: { enabled: shareCount > 0 },
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
        const displayHash = isThisRowPaying ? payTxHash : savedHash
        const displaySuccess = isThisRowPaying ? paySuccess : !!savedHash
        const shareResult = sharesData?.[shareId]
        const share =
          shareResult && shareResult.status === 'success'
            ? (shareResult.result as unknown as { amount: bigint; paid: boolean })
            : undefined
        return (
          <ShareRow
            key={shareId}
            billId={billId}
            shareId={shareId}
            share={share}
            refetchShare={refetchAllShares}
            name={shareNames[shareId]}
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
          ← Trước
        </button>
        <span style={{ fontSize: 12, color: colors.textSecondary }}>
          Trang {currentSharePage + 1}/{totalSharePages}
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
          Sau →
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
  onUpdateName: (shareId: number, name: string) => void
  onPayDirect: (shareId: number) => void
  isPaying: boolean
  hasAllowance: (amountNeeded: bigint) => boolean
  onApprove: () => void
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
  const [nameDraft, setNameDraft] = useState('')

  // Mỗi ShareRow tự quản lý trạng thái cross-chain của CHÍNH NÓ — độc lập hoàn toàn với share khác
  const { state: ccState, start: startCrossChainPay, reset: resetCrossChainPay } = useCrossChainPayment(billId, shareId)

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
      alert('Vui lòng đổi ví sang Arc Testnet, Base Sepolia, Arbitrum Sepolia hoặc Ethereum Sepolia trước khi trả tiền')
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
      ? `cross-chain từ ${chainDisplayNames[ccState.sourceChain]}`
      : paySuccess
      ? 'trả trực tiếp trên Arc'
      : 'Đã xác nhận trên Arc'

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
          display: 'grid',
          placeItems: 'center',
          background: colors.badgeBg,
          color: colors.badgeText,
          fontWeight: 700,
          fontSize: 13,
          fontFamily: 'sans-serif',
        }}
      >
        {(name || '?').charAt(0).toUpperCase()}
      </div>

      <div style={{ flex: 1, minWidth: 140 }}>
        {name ? (
          <div style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{name}</div>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={`Phần #${shareId + 1} — nhập tên của bạn`}
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
              Lưu
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
          <div style={{ color: colors.danger, fontSize: 12, fontWeight: 600, marginTop: 2 }}>Chưa trả</div>
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
            onClick={onApprove}
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
            {isApproving ? 'Đang xử lý...' : 'Cho phép dùng USDC'}
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
            {isCrossChainBusy ? 'Đang xử lý...' : isPaying ? 'Đang xử lý...' : 'Thanh toán'}
          </button>
        )}
      </div>
      </div>

      {isPaying && !payTxHash && (
        <p style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>Đang chờ ký trong ví...</p>
      )}
      {payTxHash && !paySuccess && !payError && (
        <p style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>Đã gửi, đang chờ xác nhận...</p>
      )}
      {payError && (
        <p style={{ color: colors.danger, fontSize: 11, marginTop: 6 }}>Lỗi: {payError.message.split('\n')[0]}</p>
      )}
      {ccState.status !== 'idle' && (
        <CrossChainStatusPanel state={ccState} onRetry={handleRetryCrossChain} onDismiss={resetCrossChainPay} />
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
  contributorName,
  onChangeContributorName,
  payMethod,
  onCrossChainSuccess,
  onSaveContributorName,
}: {
  billId: bigint
  amountPerSlot: bigint
  onPayDirect: () => void
  isPaying: boolean
  hasAllowance: boolean
  onApprove: () => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
  contributions: Contribution[]
  isLoadingContributions: boolean
  slotNames: Record<string, string>
  contributorName: string
  onChangeContributorName: (name: string) => void
  payMethod: PayMethod
  onCrossChainSuccess: () => void
  onSaveContributorName: (txHash: `0x${string}`, name: string) => void
}) {
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
  const { state: ccState, start: startCrossChainPay, reset: resetCrossChainPay } = useCrossChainPayment(billId, undefined)
  const isCrossChainBusy = !['idle', 'success', 'error'].includes(ccState.status)

  // Relay xong → kéo lại bill + danh sách góp (trước đây chỉ refetch khi trả trực tiếp,
  // trả cross-chain phải F5 mới thấy dòng mới). Refetch lại 1 lần sau 6s phòng RPC index trễ.
  // Đồng thời lưu tên đã nhập theo relayTxHash — trước đây chỉ trả trực tiếp mới lưu tên,
  // trả cross-chain xong danh sách chỉ hiện ví + hash, mất tên.
  useEffect(() => {
    if (ccState.status !== 'success') return
    if (ccState.relayTxHash) onSaveContributorName(ccState.relayTxHash, contributorName)
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
      alert('Vui lòng đổi ví sang Arc Testnet, Base Sepolia, Arbitrum Sepolia hoặc Ethereum Sepolia trước khi góp tiền')
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
      {/* Ô nhập tên tùy chọn — chỉ lưu trên máy người này, để mọi người biết ai đã góp */}
      {isWalletConnected && !needsApprove && !paySuccess && !isCrossChainBusy && (
        <input
          value={contributorName}
          onChange={(e) => onChangeContributorName(e.target.value)}
          placeholder="Tên của bạn (tùy chọn, hiện trong danh sách bên dưới)"
          style={{
            width: '100%',
            fontSize: 13,
            padding: '8px 12px',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            outline: 'none',
            marginBottom: 8,
            boxSizing: 'border-box',
          }}
        />
      )}

      {needsApprove ? (
        <>
          <button
            onClick={onApprove}
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
            {isApproving ? 'Đang xử lý...' : 'Cho phép Sabi dùng USDC'}
          </button>
          <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
            Cần approve 1 lần trước khi góp tiền lần đầu
          </p>
        </>
      ) : (
          isWalletConnected && (
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
              {isCrossChainBusy ? 'Đang xử lý...' : isPaying ? 'Đang xử lý...' : `Góp ${amount} USDC`}
            </button>
          )
        )}

      {/* Trạng thái giao dịch — để không ai phải đoán mò như lúc test lần đầu */}
      {isWalletConnected && (
        <>
          {isPaying && !payTxHash && (
            <p style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              Đang chờ ký trong ví...
            </p>
          )}
          {payTxHash && !paySuccess && !payError && (
            <p style={{ color: colors.textSecondary, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              Đã gửi, đang chờ xác nhận trên chain...
            </p>
          )}
          {paySuccess && (
            <div style={{ marginTop: 8, textAlign: 'center' }}>
              <p style={{ color: colors.successText, fontSize: 12, fontWeight: 600 }}>Góp tiền thành công</p>
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
                  Xem tx: {payTxHash.slice(0, 10)}...{payTxHash.slice(-8)}
                </a>
              )}
            </div>
          )}
          {payError && (
            <p style={{ color: colors.danger, fontSize: 12, marginTop: 8, textAlign: 'center' }}>
              Lỗi: {payError.message.split('\n')[0]}
            </p>
          )}
        </>
      )}
      {isWalletConnected && ccState.status !== 'idle' && (
        <CrossChainStatusPanel
          state={ccState}
          onRetry={handleRetryCrossChain}
          onDismiss={resetCrossChainPay}
          contributorName={contributorName}
        />
      )}

      {/* Danh sách người đã góp — đọc từ event SlotFilled trên chain.
          Chưa connect ví → ẩn hết danh sách + hash, chỉ hiện "Chưa có ai góp tiền."
          (CỐ Ý lệch spec gốc — chủ dự án đã chốt). */}
      <div style={{ marginTop: 20 }}>
        <div style={{ color: colors.textSecondary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Người đã góp {isWalletConnected && contributions.length > 0 && `(${contributions.length})`}
        </div>

        {!isWalletConnected && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>Chưa có ai góp tiền.</p>
        )}

        {isWalletConnected && isLoadingContributions && contributions.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>Đang tải...</p>
        )}

        {isWalletConnected && !isLoadingContributions && contributions.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>Chưa có ai góp tiền.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {isWalletConnected && visibleContributions.map((c, i) => {
            const displayName = slotNames[c.txHash]
            const shortAddress = `${c.payer.slice(0, 6)}...${c.payer.slice(-4)}`

            // Biết chính xác "trả ở đâu" CHỈ khi đúng là giao dịch vừa hoàn tất trong
            // phiên này (so khớp hash với ccState/payTxHash đang sống trong React state) —
            // các dòng góp cũ (của mình từ trước hoặc của người khác) không có dữ liệu
            // này nên hiện mô tả trung lập, không đoán bừa.
            const isThisSessionCrossChain =
              ccState.status === 'success' && ccState.relayTxHash?.toLowerCase() === c.txHash.toLowerCase()
            const isThisSessionDirect = paySuccess && payTxHash?.toLowerCase() === c.txHash.toLowerCase()
            const description =
              isThisSessionCrossChain && ccState.sourceChain
                ? `cross-chain từ ${chainDisplayNames[ccState.sourceChain]}`
                : isThisSessionDirect
                ? 'trả trực tiếp trên Arc'
                : 'Đã xác nhận trên Arc'
            // Avatar lưu local theo địa chỉ ví (giống trang Hồ sơ) — chỉ hiện được
            // nếu chính trình duyệt này đã từng lưu avatar cho địa chỉ đó, vì avatar
            // không đồng bộ qua server. Không có thì rơi về chữ cái đầu như cũ.
            const avatarUrl =
              typeof window !== 'undefined' ? localStorage.getItem(`sabi-profile-avatar-${c.payer.toLowerCase()}`) : null

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
                      <span style={{ color: colors.warning, fontWeight: 400, marginLeft: 6, fontSize: 12 }}>(lệch số tiền)</span>
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
              ← Trước
            </button>
            <span style={{ fontSize: 12, color: colors.textSecondary }}>
              Trang {currentContribPage + 1}/{totalContribPages}
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
              Sau →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { minHeight: '100vh', fontFamily: 'sans-serif', background: colors.background }

export default BillDetail
