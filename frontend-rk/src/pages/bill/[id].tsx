import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { formatUnits } from 'viem'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI, ARC_USDC_ADDRESS, ERC20_ABI } from '../../lib/contracts'
import { colors, radius } from '../../styles/theme'

// Tên người tham gia chỉ lưu ở frontend (contract không lưu tên, chỉ lưu amount)
// → đọc từ localStorage theo billId, set lúc tạo bill ở create.tsx
type LocalShareNames = Record<number, string>

const BillDetail: NextPage = () => {
  const router = useRouter()
  const { id } = router.query
  const billId = typeof id === 'string' && id !== '' ? BigInt(id) : undefined

  const { address: connectedAddress } = useAccount()
  const [shareNames, setShareNames] = useState<LocalShareNames>({})
  const [payingShareId, setPayingShareId] = useState<number | null>(null)
  // hash đã confirm của từng share — lưu bền để không mất khi F5 lại trang
  const [paidTxHashes, setPaidTxHashes] = useState<Record<number, `0x${string}`>>({})

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
  }, [billId])

  // ─── Kiểm tra ví đã approve USDC cho contract SabiBill chưa ──────────────
  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: connectedAddress ? [connectedAddress, SABI_BILL_ADDRESS] : undefined,
    query: { enabled: !!connectedAddress },
  })

  const { writeContract: approve, data: approveTx, isPending: isApproving, error: approveError } = useWriteContract()
  const { isLoading: isConfirmingApprove, isSuccess: isApproveConfirmed } = useWaitForTransactionReceipt({
    hash: approveTx,
  })

  useEffect(() => {
    if (isApproveConfirmed) refetchAllowance()
  }, [isApproveConfirmed, refetchAllowance])

  // Approve số lớn (max uint256) 1 lần — khỏi phải approve lại mỗi lần trả tiền
  const handleApprove = () => {
    approve({
      address: ARC_USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [SABI_BILL_ADDRESS, 2n ** 256n - 1n],
    })
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

  // Sau khi tx confirm → refetch lại bill để cập nhật trạng thái paid
  useEffect(() => {
    if (isShareConfirmed) {
      refetchBill()
      if (billId !== undefined && payingShareId !== null && payShareTx) {
        const next = { ...paidTxHashes, [payingShareId]: payShareTx }
        setPaidTxHashes(next)
        localStorage.setItem(`sabi-bill-${billId.toString()}-tx`, JSON.stringify(next))
      }
    }
  }, [isShareConfirmed])

  useEffect(() => {
    if (isSlotConfirmed) {
      refetchBill()
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
    })
  }

  const handlePaySlot = () => {
    if (billId === undefined || !bill) return
    paySlot({
      address: SABI_BILL_ADDRESS,
      abi: SABI_BILL_ABI,
      functionName: 'paySlot',
      args: [billId, bill.amountPerSlot],
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
        <title>Bill #{billId.toString()} — Sabi</title>
      </Head>

      <main
        style={{
          minHeight: '100vh',
          background: colors.background,
          padding: '24px 16px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: 480, margin: '0 auto 16px' }}>
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
            Bill #{billId.toString()}
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
              onPay={handlePayShare}
              isPaying={isPayingShare || isConfirmingShare}
              payingShareId={payingShareId}
              paidTxHashes={paidTxHashes}
              onUpdateName={updateShareName}
              hasAllowance={hasEnoughAllowance}
              onApprove={handleApprove}
              isApproving={isApprovingNow}
              isWalletConnected={!!connectedAddress}
              payTxHash={payShareTx}
              paySuccess={isShareConfirmed}
              payError={payShareError}
            />
          )}

          {mode === 'OPEN_SLOT' && (
            <OpenSlotInfo
              amountPerSlot={bill.amountPerSlot}
              matchedSlotsCount={Number(bill.matchedSlotsCount ?? 0)}
              numSlots={Number(bill.numSlots ?? 0)}
              extraReceived={bill.extraReceived}
              onPay={handlePaySlot}
              isPaying={isPayingSlot || isConfirmingSlot}
              hasAllowance={hasEnoughAllowance(bill.amountPerSlot)}
              onApprove={handleApprove}
              isApproving={isApprovingNow}
              isWalletConnected={!!connectedAddress}
              payTxHash={paySlotTx}
              paySuccess={isSlotConfirmed}
              payError={paySlotError}
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
  onPay,
  isPaying,
  payingShareId,
  paidTxHashes,
  onUpdateName,
  hasAllowance,
  onApprove,
  isApproving,
  isWalletConnected,
  payTxHash,
  paySuccess,
  payError,
}: {
  billId: bigint
  shareCount: number
  shareNames: LocalShareNames
  connectedAddress: `0x${string}` | undefined
  onPay: (shareId: number) => void
  isPaying: boolean
  payingShareId: number | null
  paidTxHashes: Record<number, `0x${string}`>
  onUpdateName: (shareId: number, name: string) => void
  hasAllowance: (amountNeeded: bigint) => boolean
  onApprove: () => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
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
            onPay={onPay}
            isPaying={isThisRowPaying && isPaying}
            hasAllowance={hasAllowance}
            onApprove={onApprove}
            isApproving={isApproving}
            isWalletConnected={isWalletConnected}
            payTxHash={displayHash}
            paySuccess={displaySuccess}
            payError={isThisRowPaying ? payError : null}
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
  onPay,
  isPaying,
  hasAllowance,
  onApprove,
  isApproving,
  isWalletConnected,
  payTxHash,
  paySuccess,
  payError,
}: {
  billId: bigint
  shareId: number
  name: string | undefined
  onUpdateName: (shareId: number, name: string) => void
  onPay: (shareId: number) => void
  isPaying: boolean
  hasAllowance: (amountNeeded: bigint) => boolean
  onApprove: () => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
}) {
  const [nameDraft, setNameDraft] = useState('')

  const { data: share, refetch: refetchShare } = useReadContract({
    address: SABI_BILL_ADDRESS,
    abi: SABI_BILL_ABI,
    functionName: 'getShare',
    args: [billId, BigInt(shareId)],
  })

  useEffect(() => {
    if (paySuccess) refetchShare()
  }, [paySuccess])

  if (!share) return null

  const amount = formatUnits(share.amount, 6)
  const needsApprove = isWalletConnected && !hasAllowance(share.amount)
  const isPaid = share.paid || paySuccess

  const saveName = () => {
    if (!nameDraft.trim()) return
    onUpdateName(shareId, nameDraft.trim())
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
            {isApproving ? 'Đang approve...' : 'Cho phép dùng USDC'}
          </button>
        ) : (
          <button
            onClick={() => onPay(shareId)}
            disabled={isPaying || !isWalletConnected}
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#fff',
              background: isPaying || !isWalletConnected ? colors.textMuted : colors.primary,
              border: 'none',
              borderRadius: radius.button,
              padding: '8px 14px',
              cursor: isPaying || !isWalletConnected ? 'not-allowed' : 'pointer',
            }}
          >
            {isPaying ? 'Đang xử lý...' : 'Trả tiền'}
          </button>
        )}
      </div>

      {/* Trạng thái tx — chỉ hiện khi đang có action chạy để tránh rối các share khác */}
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
    </div>
  )
}

function OpenSlotInfo({
  amountPerSlot,
  matchedSlotsCount,
  numSlots,
  extraReceived,
  onPay,
  isPaying,
  hasAllowance,
  onApprove,
  isApproving,
  isWalletConnected,
  payTxHash,
  paySuccess,
  payError,
}: {
  amountPerSlot: bigint
  matchedSlotsCount: number
  numSlots: number
  extraReceived: bigint
  onPay: () => void
  isPaying: boolean
  hasAllowance: boolean
  onApprove: () => void
  isApproving: boolean
  isWalletConnected: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
}) {
  const amount = formatUnits(amountPerSlot, 6)
  const extra = formatUnits(extraReceived, 6)

  const needsApprove = isWalletConnected && !hasAllowance

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
            {isApproving ? 'Đang approve...' : 'Cho phép Sabi dùng USDC'}
          </button>
          <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 6, textAlign: 'center' }}>
            Cần approve 1 lần trước khi góp tiền lần đầu
          </p>
        </>
      ) : (
        <button
          onClick={onPay}
          disabled={isPaying || !isWalletConnected}
          style={{
            width: '100%',
            fontSize: 14,
            fontWeight: 600,
            color: '#fff',
            background: isPaying || !isWalletConnected ? colors.textMuted : colors.primary,
            border: 'none',
            borderRadius: radius.button,
            padding: '12px',
            cursor: isPaying || !isWalletConnected ? 'not-allowed' : 'pointer',
          }}
        >
          {!isWalletConnected ? 'Kết nối ví để góp tiền' : isPaying ? 'Đang xử lý...' : `Góp ${amount} USDC`}
        </button>
      )}

      {/* Trạng thái giao dịch — để không ai phải đoán mò như lúc test lần đầu */}
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
    </div>
  )
}

export default BillDetail