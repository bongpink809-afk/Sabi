import { useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { useTranslation } from 'next-i18next'
import { formatUnits } from 'viem'
import { Modal } from './Modal'
import { colors } from '../styles/theme'
import { truncateHash } from '../lib/format'
import { ARC_USDC_ADDRESS, ERC20_ABI } from '../lib/contracts'
import { arcTestnet } from '../wagmi'

const USDC_FAUCET_URL = 'https://faucet.circle.com/'

const CONFETTI_COLORS = ['#7C6AEF', '#17A268', '#D98E12', '#9A8BFF', '#4ADE97', '#E8B54A', '#17151F']
const CONFETTI_COUNT = 40

const fmt2 = (n: bigint) => Number(formatUnits(n, 6)).toFixed(2)

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

type LogTone = 'default' | 'success'
interface LogEntry {
  time: string
  text: string
  tone: LogTone
}
const LOG_TONE_COLOR: Record<LogTone, string> = { default: '#8A94AC', success: '#4ADE97' }

// Modal thanh toán trực tiếp trên Arc — thay cho các dòng text trạng thái rời
// rạc trước đây (isPaying/payTxHash/paySuccess/payError hiện inline dưới nút).
// Chỉ mở khi needsApprove đã false (nút Approve/Pay đã tự gate ở ShareRow/
// OpenSlotInfo từ trước), nên modal này không cần tự xử lý bước approve.
export function PaymentArcModal({
  amount,
  payerName,
  functionName,
  onClose,
  onPay,
  isPaying,
  payTxHash,
  paySuccess,
  payError,
  payerAddress,
}: {
  amount: bigint
  payerName: string
  functionName: 'payShare' | 'paySlot'
  onClose: () => void
  onPay: () => void
  isPaying: boolean
  payTxHash: `0x${string}` | undefined
  paySuccess: boolean
  payError: Error | null
  // Địa chỉ ví đang trả khi KHÔNG có ví wagmi connect (vd ví Circle đăng nhập
  // bằng email) — wagmi's useAccount().address vẫn ưu tiên nếu có.
  payerAddress?: `0x${string}`
}) {
  const { t } = useTranslation('common')
  const { address: wagmiAddress } = useAccount()
  const address = wagmiAddress ?? payerAddress

  const { data: balance } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: arcTestnet.id,
    query: { enabled: !!address, refetchOnWindowFocus: false, staleTime: 15_000 },
  }) as { data: bigint | undefined }

  const [logs, setLogs] = useState<LogEntry[]>([])
  const loggedPhaseRef = useRef<string | null>(null)
  const phase = payError ? 'error' : paySuccess ? 'success' : payTxHash ? 'confirming' : isPaying ? 'signing' : 'idle'

  useEffect(() => {
    if (loggedPhaseRef.current === phase) return
    loggedPhaseRef.current = phase
    if (phase === 'signing') {
      setLogs((prev) => [...prev, { time: timestamp(), text: t('paymentModal.arc.log_signing', { fn: functionName }), tone: 'default' }])
    } else if (phase === 'confirming') {
      setLogs((prev) => [...prev, { time: timestamp(), text: t('paymentModal.arc.log_sent'), tone: 'default' }])
    } else if (phase === 'success' && payTxHash) {
      setLogs((prev) => [...prev, { time: timestamp(), text: t('paymentModal.arc.log_confirmed', { hash: truncateHash(payTxHash) }), tone: 'success' }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Giữ màn success thêm 700ms sau khi confirmed để log kịp hiện dòng cuối +
  // coin mờ dần trước khi chuyển sang màn "Đã trả xong", giống 2 modal kia.
  const [showDone, setShowDone] = useState(false)
  useEffect(() => {
    if (phase === 'success') {
      const timer = setTimeout(() => setShowDone(true), 700)
      return () => clearTimeout(timer)
    }
  }, [phase])

  const [coinVisible, setCoinVisible] = useState(false)
  const [coinAtEnd, setCoinAtEnd] = useState(false)
  useEffect(() => {
    if (phase === 'signing') {
      setCoinVisible(true)
      setCoinAtEnd(false)
      const timer = setTimeout(() => setCoinAtEnd(true), 250)
      return () => clearTimeout(timer)
    }
    if (phase === 'success') {
      setCoinVisible(false)
    }
  }, [phase])

  const confettiPieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => {
        const size = 4 + Math.random() * 6
        return {
          id: i,
          left: Math.random() * 100,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          delay: Math.random() * 0.5,
          duration: 1.4 + Math.random() * 1.6,
          width: size,
          height: size * 0.45,
        }
      }),
    []
  )

  // Ví Circle có thể chưa kịp trả về tx hash (đang poll trạng thái phía
  // backend) ngay lúc challenge hoàn tất — vẫn cho hiện màn "đã trả xong",
  // chỉ ẩn link ArcScan nếu chưa có hash thay vì treo mãi màn xử lý.
  if (showDone && (payTxHash || paySuccess)) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(23, 21, 31, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
        <style>{`
          @keyframes sabi-arc-check-pop { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          @keyframes sabi-arc-check-draw { to { stroke-dashoffset: 0; } }
          @keyframes sabi-arc-confetti-fall { to { transform: translateY(90vh) rotate(720deg); opacity: .08; } }
        `}</style>
        <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
          {confettiPieces.map((p) => (
            <span
              key={p.id}
              style={{
                position: 'absolute',
                top: -12,
                left: `${p.left}%`,
                width: p.width,
                height: p.height,
                background: p.color,
                borderRadius: 2,
                animation: `sabi-arc-confetti-fall ${p.duration}s linear ${p.delay}s 1 forwards`,
              }}
            />
          ))}
        </div>
        <div style={{ position: 'relative', background: colors.surface, borderRadius: 22, padding: '32px 24px', width: '100%', maxWidth: 540, textAlign: 'center', boxShadow: `0 8px 32px ${colors.shadowColor}` }}>
          <div style={{ width: 68, height: 68, borderRadius: '50%', border: `2.5px solid ${colors.success}`, display: 'grid', placeItems: 'center', margin: '0 auto 14px', animation: 'sabi-arc-check-pop 0.6s cubic-bezier(.34,1.56,.64,1)' }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M7 17 L13 23 L25 9" stroke={colors.success} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" style={{ strokeDasharray: 28, strokeDashoffset: 28, animation: 'sabi-arc-check-draw 0.35s ease-out 0.3s forwards' }} />
            </svg>
          </div>
          <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: colors.textPrimary }}>{t('paymentModal.success.title')}</h2>
          <p style={{ margin: '8px 0 18px', fontSize: 13, color: colors.textSecondary }}>{t('paymentModal.arc.success_subtitle')}</p>
          {payTxHash && (
            <a
              href={`https://testnet.arcscan.app/tx/${payTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', marginBottom: 20, color: colors.primary, fontSize: 13, textDecoration: 'underline', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
            >
              {t('paymentModal.success.arcscan_link', { hash: truncateHash(payTxHash) })}
            </a>
          )}
          <div>
            <button
              onClick={onClose}
              style={{ display: 'inline-block', padding: '11px 32px', borderRadius: 50, fontSize: 14, fontWeight: 600, color: '#fff', background: colors.buttonPrimary, border: 'none', cursor: 'pointer' }}
            >
              {t('paymentModal.success.view_bill_button')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Đang đọc balance lần đầu — chưa biết đủ hay thiếu, hiện khung rỗng thay vì đoán
  if (balance === undefined) {
    return (
      <Modal onClose={onClose} maxWidth={540} cardRadius={22}>
        <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: colors.textPrimary }}>
          {t('paymentModal.chain.title', { amount: fmt2(amount), name: payerName })}
        </p>
        <p style={{ margin: 0, fontSize: 13, color: colors.textSecondary }}>{t('paymentModal.chain.balance_loading')}</p>
      </Modal>
    )
  }

  const insufficient = balance < amount

  if (insufficient) {
    return (
      <Modal onClose={onClose} maxWidth={540} cardRadius={22}>
        <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: colors.textPrimary }}>
          {t('paymentModal.chain.title', { amount: fmt2(amount), name: payerName })}
        </p>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: colors.textSecondary }}>{t('paymentModal.arc.subtitle_default')}</p>

        <div style={{ background: colors.dangerBg, border: `1px solid ${colors.danger}`, borderRadius: 14, padding: '14px 16px', marginBottom: 18 }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, color: colors.danger, margin: '0 0 5px' }}>{t('paymentModal.arc.insufficient_title')}</p>
          <p style={{ fontSize: 12.5, color: '#B03050', margin: '0 0 12px' }}>
            {t('paymentModal.arc.insufficient_body', { balance: fmt2(balance), needed: fmt2(amount) })}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={USDC_FAUCET_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11.5, fontWeight: 600, padding: '6px 12px', borderRadius: 99, border: `1.5px solid ${colors.danger}`, background: '#fff', color: colors.danger, textDecoration: 'none', display: 'inline-block' }}
            >
              {t('paymentModal.arc.faucet_usdc')}
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={CANCEL_BTN_STYLE}>{t('paymentModal.chain.cancel')}</button>
          <button disabled style={{ ...PRIMARY_BTN_STYLE, background: colors.textMuted, cursor: 'not-allowed' }}>{t('paymentModal.arc.pay_button')}</button>
        </div>
      </Modal>
    )
  }

  const node2State = phase === 'success' || phase === 'confirming' ? (phase === 'success' ? 'done' : 'on') : phase === 'signing' ? 'on' : 'off'
  const showButtons = phase === 'idle' || phase === 'error'

  return (
    <Modal maxWidth={540} cardRadius={22} onClose={showButtons ? onClose : undefined}>
      <style>{`
        @keyframes sabi-arc-orb-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
      `}</style>

      <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: colors.textPrimary }}>
        {t('paymentModal.chain.title', { amount: fmt2(amount), name: payerName })}
      </p>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: colors.textSecondary }}>
        {t('paymentModal.arc.subtitle_ready', { balance: fmt2(balance) })}
      </p>

      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ position: 'absolute', left: 60, right: 60, top: 24, height: 2, background: 'repeating-linear-gradient(90deg, #D6CFF0 0 7px, transparent 7px 13px)', zIndex: 1 }} />
        <div
          style={{
            position: 'absolute',
            top: 11,
            left: coinAtEnd ? '88%' : '12%',
            transform: 'translateX(-50%)',
            zIndex: 3,
            width: 26,
            height: 26,
            borderRadius: '50%',
            background: `radial-gradient(circle at 35% 30%, #A79BFF, ${colors.primary} 65%)`,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
            opacity: coinVisible ? 1 : 0,
            boxShadow: '0 3px 12px rgba(124,106,239,.45)',
            transition: 'left 1.6s cubic-bezier(.45,0,.25,1), opacity .3s',
            pointerEvents: 'none',
          }}
        >
          $
        </div>

        <ArcNode icon="✅" orbState="done" label={t('paymentModal.arc.node_check_balance')} sub={t('paymentModal.arc.node_check_balance_sub')} subTone="ok" />
        <ArcNode
          icon="💸"
          orbState={node2State}
          label={t('paymentModal.arc.node_payment')}
          sub={node2State === 'done' && payTxHash ? truncateHash(payTxHash) : node2State === 'on' ? t('paymentModal.arc.node_payment_confirming') : ''}
          subTone={node2State === 'done' ? 'ok' : 'active'}
        />
      </div>

      {logs.length > 0 && (
        <div style={{ background: '#111018', borderRadius: 12, padding: '6px 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 11.5, maxHeight: 110, overflowY: 'auto' }}>
          {logs.map((entry, i) => (
            <div key={i} style={{ padding: '5px 14px', display: 'flex', gap: 10 }}>
              <span style={{ color: colors.primary, flexShrink: 0, fontSize: 10.5 }}>{entry.time}</span>
              <span style={{ color: LOG_TONE_COLOR[entry.tone] }}>{entry.text}</span>
            </div>
          ))}
        </div>
      )}

      {phase === 'error' && payError && (
        <p style={{ color: colors.danger, fontSize: 12, marginTop: 12 }}>{payError.message.split('\n')[0]}</p>
      )}

      {showButtons && (
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button onClick={onClose} style={CANCEL_BTN_STYLE}>{t('paymentModal.chain.cancel')}</button>
          <button onClick={onPay} style={PRIMARY_BTN_STYLE}>{t('paymentModal.arc.pay_button')}</button>
        </div>
      )}
    </Modal>
  )
}

const CANCEL_BTN_STYLE: React.CSSProperties = {
  padding: '10px 22px',
  borderRadius: 50,
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  background: '#F0EDF8',
  color: colors.textSecondary,
  border: '1.5px solid #B0A8C8',
}

const PRIMARY_BTN_STYLE: React.CSSProperties = {
  padding: '10px 22px',
  borderRadius: 50,
  fontSize: 13.5,
  fontWeight: 600,
  cursor: 'pointer',
  background: colors.buttonPrimary,
  color: '#fff',
  border: 'none',
}

function ArcNode({ icon, orbState, label, sub, subTone }: { icon: string; orbState: 'off' | 'on' | 'done'; label: string; sub: string; subTone: 'active' | 'ok' }) {
  const orbStyle: React.CSSProperties =
    orbState === 'done'
      ? { borderColor: colors.success, background: '#DFF5EA', animation: 'none' }
      : orbState === 'on'
      ? { borderColor: colors.primary, background: colors.selectedBg, animation: 'sabi-arc-orb-pulse 1.2s infinite' }
      : { borderColor: '#D6CFF0', background: colors.background, animation: 'none' }
  const subColor = subTone === 'ok' ? colors.success : colors.primary

  return (
    <div style={{ textAlign: 'center', width: 120, position: 'relative', zIndex: 2 }}>
      <div style={{ width: 48, height: 48, borderRadius: '50%', margin: '0 auto', border: '1.5px solid', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, transition: 'all .4s', ...orbStyle }}>
        {icon}
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: colors.textMuted, marginTop: 7 }}>{label}</div>
      <div style={{ fontSize: 9.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', marginTop: 3, minHeight: 12, color: sub ? subColor : 'transparent' }}>
        {sub || '.'}
      </div>
    </div>
  )
}
