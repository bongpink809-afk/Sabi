import { CrossChainState } from '../../hooks/useCrossChainPayment'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient, useSwitchChain } from 'wagmi'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { formatUnits } from 'viem'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI, ARC_USDC_ADDRESS, ERC20_ABI, baseSepolia, arbitrumSepolia } from '../../lib/contracts'
import { CrossChainStatusPanel } from '../../components/CrossChainStatus'
import { arcTestnet } from '../../wagmi'
import { useCrossChainPayment } from '../../hooks/useCrossChainPayment'
import { colors, radius } from '../../styles/theme'

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

const BillDetail: NextPage = () => {
  const router = useRouter()
  const { id } = router.query
  const billId = typeof id === 'string' && id !== '' ? BigInt(id) : undefined

  const { address: connectedAddress } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { chainId: currentChainId } = useAccount()
  const payMethod: 'arc' | 'base' | 'arbitrum' | 'unsupported' =
  currentChainId === arcTestnet.id
    ? 'arc'
    : currentChainId === baseSepolia.id
    ? 'base'
    : currentChainId === arbitrumSepolia.id
    ? 'arbitrum'
    : 'unsupported'
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const [shareNames, setShareNames] = useState<LocalShareNames>({})
  const [billTitle, setBillTitle] = useState<string | null>(null)
  const [payingShareId, setPayingShareId] = useState<number | null>(null)
  // hash đã confirm của từng share — lưu bền để không mất khi F5 lại trang
  const [paidTxHashes, setPaidTxHashes] = useState<Record<number, `0x${string}`>>({})
  

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
      const allLogs: any[] = []

      let toBlock = latestBlock
      let chunkCount = 0
      while (toBlock >= 0n && chunkCount < MAX_CHUNKS) {
        const fromBlock = toBlock > CHUNK_SIZE ? toBlock - CHUNK_SIZE + 1n : 0n
        const logs = await publicClient.getContractEvents({
          address: SABI_BILL_ADDRESS,
          abi: SABI_BILL_ABI,
          eventName: 'SlotFilled',
          args: { billId },
          fromBlock,
          toBlock,
        })
        allLogs.push(...logs)
        chunkCount++

        if (fromBlock === 0n) break
        toBlock = fromBlock - 1n
      }

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
        // bỏ qua nếu localStorage hỏng, chỉ hiển thị "Share #i"
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

  // Tự động reset về "Approve" nếu sau 20s không có phản hồi từ ví
  // (xử lý trường hợp user đóng popup MetaMask bằng nút X, không bấm Reject)
  useEffect(() => {
    if (!isApproving) return
    const timeout = setTimeout(() => {
      resetApprove()
    }, 45000)
    return () => clearTimeout(timeout)
  }, [isApproving])

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

  useEffect(() => {
    if (isSlotConfirmed && paySlotTx) {
      refetchBill()
      fetchContributions()
      if (pendingContributorName && billId !== undefined) {
        const next = { ...slotNames, [paySlotTx]: pendingContributorName }
        setSlotNames(next)
        localStorage.setItem(`sabi-bill-${billId.toString()}-slotnames`, JSON.stringify(next))
      }
    }
  }, [isSlotConfirmed])

  useEffect(() => {
    if (isSlotConfirmed) {
      refetchBill()
      fetchContributions()
    }
  }, [isSlotConfirmed])

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

  return (
    <>
      <Head>
        <title>{billTitle ? `${billTitle} — Sabi` : `Bill #${billId.toString()} — Sabi`}</title>
      </Head>

      <main
        style={{
          minHeight: '100vh',
          background: colors.background,
          padding: '24px 16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: 480, margin: '0 auto 16px', gap: 8 }}>
           
          <ConnectButton />
      
        </div>

        <div
          style={{
            maxWidth: 480,
            margin: '0 auto',
            background: colors.surface,
            borderRadius: radius.card,
            border: `1px solid ${colors.border}`,
            padding: 24,
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, color: colors.textPrimary, marginBottom: 4 }}>
            {billTitle ?? `Bill #${billId.toString()}`}
          </h1>
          <p style={{ color: colors.textSecondary, fontSize: 14, marginBottom: 20 }}>
            {mode === 'ASSIGNED' ? 'Chia theo người' : 'Góp theo slot'}
          </p>

          {mode === 'ASSIGNED' && (
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
          />
        )}

          {mode === 'OPEN_SLOT' && (
          <OpenSlotInfo
            billId={billId}
            amountPerSlot={bill.amountPerSlot}
            matchedSlotsCount={Number(bill.matchedSlotsCount ?? 0)}
            numSlots={Number(bill.numSlots ?? 0)}
            extraReceived={bill.extraReceived}
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
            connectedAddress={connectedAddress}
            contributorName={contributorName}
            onChangeContributorName={setContributorName}
            payMethod={payMethod}
          />
        )}
        </div>
      </main>
    </>
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
      }}
    >
      {children}
    </div>
  )
}

// Component con này đọc từng Share riêng bằng getShare — cần vì Bill struct
// không trả về mảng share, chỉ có shareCount.
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
  payMethod: 'arc' | 'base' | 'arbitrum' | 'unsupported'
}) {
  const shareIds = Array.from({ length: shareCount }, (_, i) => i)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {shareIds.map((shareId) => {
        const isThisRowPaying = payingShareId === shareId
        const savedHash = paidTxHashes[shareId]
        const displayHash = isThisRowPaying ? payTxHash : savedHash
        const displaySuccess = isThisRowPaying ? paySuccess : !!savedHash
        return (
          <ShareRow
            key={shareId}
            billId={billId}
            shareId={shareId}
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
          />
        )
      })}
    </div>
  )
}

function ShareRow({
  billId,
  shareId,
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
}: {
  billId: bigint
  shareId: number
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
  payMethod: 'arc' | 'base' | 'arbitrum' | 'unsupported'
}) {
  const [nameDraft, setNameDraft] = useState('')

  const { data: share, refetch: refetchShare } = useReadContract({
    address: SABI_BILL_ADDRESS,
    abi: SABI_BILL_ABI,
    functionName: 'getShare',
    chainId: arcTestnet.id,
    args: [billId, BigInt(shareId)],
  })

  // Mỗi ShareRow tự quản lý trạng thái cross-chain của CHÍNH NÓ — độc lập hoàn toàn với share khác
  const { state: ccState, start: startCrossChainPay, reset: resetCrossChainPay } = useCrossChainPayment(billId, shareId)

  useEffect(() => {
    if (paySuccess || ccState.status === 'success') refetchShare()
  }, [paySuccess, ccState.status])

  if (!share) return null

  const isCrossChainBusy = !['idle', 'success', 'error'].includes(ccState.status)
  const amount = formatUnits(share.amount, 6)
  const needsApprove = isWalletConnected && !hasAllowance(share.amount)
  const isPaid = share.paid || paySuccess || ccState.status === 'success'

  const saveName = () => {
    if (!nameDraft.trim()) return
    onUpdateName(shareId, nameDraft.trim())
  }

  const handleClickPay = async () => {
    if (payMethod === 'unsupported') {
      alert('Vui lòng đổi ví sang Arc Testnet, Base Sepolia hoặc Arbitrum Sepolia trước khi trả tiền')
      return
    }
    if (payMethod === 'base' || payMethod === 'arbitrum') {
      await startCrossChainPay(share.amount, payMethod)
      return
    }
    onPayDirect(shareId)
  }

  const handleRetryCrossChain = () => {
    const source = ccState.sourceChain ?? (payMethod === 'arbitrum' ? 'arbitrum' : 'base')
    startCrossChainPay(share.amount, source)
  }

  return (
    <div
      style={{
        padding: '12px 14px',
        background: colors.backgroundSubtle,
        borderRadius: 8,
        border: `1px solid ${colors.borderLight}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ flex: 1, marginRight: 12 }}>
          {name ? (
            <div style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{name}</div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={`Share #${shareId + 1} — nhập tên của bạn`}
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
          <div style={{ color: colors.textSecondary, fontSize: 13, marginTop: name ? 0 : 4 }}>{amount} USDC</div>
        </div>

        {isPaid ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: colors.successText,
              background: colors.successBg,
              padding: '4px 10px',
              borderRadius: 999,
            }}
          >
            Đã trả
          </span>
        ) : needsApprove ? (
          <button
            onClick={onApprove}
            disabled={isApproving}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: isApproving ? colors.textMuted : colors.primary,
              border: 'none',
              borderRadius: radius.button,
              padding: '8px 14px',
              cursor: isApproving ? 'not-allowed' : 'pointer',
            }}
          >
            {isApproving ? 'Approving...' : 'Approve'}
          </button>
        ) : (
          <button
            onClick={handleClickPay}
            disabled={isPaying || !isWalletConnected || isCrossChainBusy}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: isPaying || !isWalletConnected || isCrossChainBusy ? colors.textMuted : colors.primary,
              border: 'none',
              borderRadius: radius.button,
              padding: '8px 14px',
              cursor: isPaying || !isWalletConnected || isCrossChainBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {isCrossChainBusy ? 'Đang xử lý...' : isPaying ? 'Đang xử lý...' : 'Trả tiền'}
          </button>
        )}
      </div>

      {isPaying && !payTxHash && (
        <p style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>Đang chờ ký trong ví...</p>
      )}
      {payTxHash && !paySuccess && !payError && (
        <p style={{ color: colors.textSecondary, fontSize: 11, marginTop: 6 }}>Đã gửi, đang chờ xác nhận...</p>
      )}
      {paySuccess && payTxHash && (
<a        
          href={`https://testnet.arcscan.app/tx/${payTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'block',
            marginTop: 6,
            color: colors.primary,
            fontSize: 11,
            textDecoration: 'underline',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          Xem tx: {payTxHash.slice(0, 10)}...{payTxHash.slice(-8)}
        </a>
      )}
      {payError && (
        <p style={{ color: colors.danger, fontSize: 11, marginTop: 6 }}>Lỗi: {payError.message.split('\n')[0]}</p>
      )}
      {!isPaid && ccState.status !== 'idle' && (
        <CrossChainStatusPanel state={ccState} onRetry={handleRetryCrossChain} onDismiss={resetCrossChainPay} />
      )}
    </div>
  )
}

function OpenSlotInfo({
  billId,
  amountPerSlot,
  matchedSlotsCount,
  numSlots,
  extraReceived,
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
  connectedAddress,
  contributorName,
  onChangeContributorName,
  payMethod,
}: {
  billId: bigint
  amountPerSlot: bigint
  matchedSlotsCount: number
  numSlots: number
  extraReceived: bigint
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
  connectedAddress: `0x${string}` | undefined
  contributorName: string
  onChangeContributorName: (name: string) => void
  payMethod: 'arc' | 'base' | 'arbitrum' | 'unsupported'
}) {
  const amount = formatUnits(amountPerSlot, 6)
  const extra = formatUnits(extraReceived, 6)

  const needsApprove = isWalletConnected && !hasAllowance

  // OPEN_SLOT dùng shareId: undefined — đúng thiết kế gốc, không gắn 1 người/1 share cố định
  const { state: ccState, start: startCrossChainPay, reset: resetCrossChainPay } = useCrossChainPayment(billId, undefined)
  const isCrossChainBusy = !['idle', 'success', 'error'].includes(ccState.status)

  const handleClickPay = async () => {
    if (payMethod === 'unsupported') {
      alert('Vui lòng đổi ví sang Arc Testnet, Base Sepolia hoặc Arbitrum Sepolia trước khi góp tiền')
      return
    }
    if (payMethod === 'base' || payMethod === 'arbitrum') {
      await startCrossChainPay(amountPerSlot, payMethod)
      return
    }
    onPayDirect()
  }

  const handleRetryCrossChain = () => {
    const source = ccState.sourceChain ?? (payMethod === 'arbitrum' ? 'arbitrum' : 'base')
    startCrossChainPay(amountPerSlot, source)
  }

  return (
    <div>
      <div
        style={{
          background: colors.backgroundSubtle,
          borderRadius: 8,
          border: `1px solid ${colors.borderLight}`,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <div style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 4 }}>Mỗi người góp</div>
        <div style={{ color: colors.textPrimary, fontSize: 18, fontWeight: 700 }}>{amount} USDC</div>

        <div style={{ color: colors.textSecondary, fontSize: 13, marginTop: 12 }}>
          Đã đủ {matchedSlotsCount}/{numSlots} slot
        </div>
        {extraReceived > 0n && (
          <div style={{ color: colors.warning, fontSize: 12, marginTop: 4 }}>
            Có {extra} USDC góp lệch số tiền chuẩn
          </div>
        )}
      </div>

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
              background: isApproving ? colors.textMuted : colors.primary,
              border: 'none',
              borderRadius: radius.button,
              padding: '12px',
              cursor: isApproving ? 'not-allowed' : 'pointer',
            }}
          >
            {isApproving ? 'Approving...' : 'Cho phép Sabi dùng USDC'}
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
                background: isPaying || isCrossChainBusy ? colors.textMuted : colors.primary,
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

      {/* Danh sách người đã góp — đọc từ event SlotFilled trên chain */}
      <div style={{ marginTop: 20 }}>
        <div style={{ color: colors.textSecondary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          Người đã góp {contributions.length > 0 && `(${contributions.length})`}
        </div>

        {isLoadingContributions && contributions.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>Đang tải...</p>
        )}

        {!isLoadingContributions && contributions.length === 0 && (
          <p style={{ color: colors.textMuted, fontSize: 12 }}>Chưa có ai góp tiền.</p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {contributions.map((c, i) => {
            const displayName = slotNames[c.txHash]
            const shortAddress = `${c.payer.slice(0, 6)}...${c.payer.slice(-4)}`
            const isYou = connectedAddress && c.payer.toLowerCase() === connectedAddress.toLowerCase()
            return (
              <div
                key={`${c.txHash}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: isYou ? colors.backgroundSubtle : colors.backgroundSubtle,
                  border: isYou ? `1.5px solid ${colors.primary}` : '1.5px solid transparent',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              >
                <div>
                  <div style={{ color: colors.textPrimary, fontWeight: 600 }}>
                    {displayName ?? shortAddress}
                    {!c.matched && (
                      <span style={{ color: colors.warning, fontWeight: 400, marginLeft: 6 }}>(lệch số tiền)</span>
                    )}
                  </div>
<a                
                    href={`https://testnet.arcscan.app/tx/${c.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      color: colors.primary,
                      fontSize: 11,
                      textDecoration: 'underline',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                    }}
                  >
                    {c.txHash.slice(0, 8)}...{c.txHash.slice(-6)}
                  </a>
                </div>
                <div style={{ color: colors.textSecondary, fontWeight: 600 }}>{formatUnits(c.amount, 6)} USDC</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default BillDetail