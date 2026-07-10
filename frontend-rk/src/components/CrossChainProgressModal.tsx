import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'next-i18next'
import { Modal } from './Modal'
import { colors } from '../styles/theme'
import { CrossChainState } from '../hooks/useCrossChainPayment'
import { truncateHash } from '../lib/format'

const SOURCE_CHAIN_NAME = {
  base: 'Base Sepolia',
  arbitrum: 'Arbitrum Sepolia',
  ethereum: 'Ethereum Sepolia',
} as const

type LogTone = 'default' | 'success' | 'warning'
interface LogEntry {
  time: string
  text: string
  tone: LogTone
}

// Màu riêng cho log trên nền tối — KHÔNG tái dùng colors.success/warning (định
// cho nền sáng, quá tối trên nền #17151F) mà dùng bản sáng hơn để đủ tương phản.
const LOG_TONE_COLOR: Record<LogTone, string> = {
  default: '#8A94AC',
  success: '#4ADE97',
  warning: '#E8B54A',
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

type OrbState = 'off' | 'on' | 'done'
type SubTone = 'muted' | 'active' | 'ok'

// Modal 2 — progress CCTP V2. Log + trạng thái node chỉ phản ánh transition
// THẬT của useCrossChainPayment (không tự bịa bước chưa xảy ra) — kể cả khi
// mở lại sau khi resume từ localStorage, log tái tạo đúng những gì đã biết chắc.
export function CrossChainProgressModal({
  state,
  isDelayed,
  onCancelBurning,
}: {
  state: CrossChainState
  isDelayed?: boolean
  onCancelBurning?: () => void
}) {
  const { t } = useTranslation('common')
  const [logs, setLogs] = useState<LogEntry[]>([])
  const delayedLoggedRef = useRef(false)
  // Chặn log lặp đôi khi React StrictMode (dev) double-invoke effect —
  // không dùng dependency array suông vì mount→cleanup→mount lại vẫn
  // cùng 1 status, phải tự nhớ status cuối đã log rồi.
  const loggedStatusRef = useRef<CrossChainState['status'] | null>(null)

  const chainName = state.sourceChain ? SOURCE_CHAIN_NAME[state.sourceChain] : ''

  useEffect(() => {
    if (loggedStatusRef.current === state.status) return
    loggedStatusRef.current = state.status
    const append = (entries: LogEntry[]) => setLogs((prev) => [...prev, ...entries])

    if (state.status === 'checking_balance') {
      append([{ time: timestamp(), text: t('paymentModal.progress.log_checking_balance', { chain: chainName }), tone: 'default' }])
    } else if (state.status === 'burning') {
      append([{ time: timestamp(), text: t('paymentModal.progress.log_burning', { chain: chainName }), tone: 'default' }])
    } else if (state.status === 'waiting_attestation') {
      const entries: LogEntry[] = []
      if (state.burnTxHash) {
        entries.push({
          time: timestamp(),
          text: t('paymentModal.progress.log_burn_confirmed', { hash: truncateHash(state.burnTxHash) }),
          tone: 'success',
        })
      }
      entries.push({ time: timestamp(), text: t('paymentModal.progress.log_poll_attestation'), tone: 'warning' })
      append(entries)
    } else if (state.status === 'relaying') {
      append([
        { time: timestamp(), text: t('paymentModal.progress.log_attestation_ready'), tone: 'success' },
        { time: timestamp(), text: t('paymentModal.progress.log_calling_relay'), tone: 'default' },
      ])
    } else if (state.status === 'success') {
      append([{ time: timestamp(), text: t('paymentModal.progress.log_success_final'), tone: 'success' }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status])

  useEffect(() => {
    if (isDelayed && state.status === 'waiting_attestation' && !delayedLoggedRef.current) {
      delayedLoggedRef.current = true
      setLogs((prev) => [...prev, { time: timestamp(), text: t('paymentModal.progress.log_attestation_delayed'), tone: 'warning' }])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDelayed, state.status])

  // Coin đi dọc track: xuất hiện lúc burn xong, trôi tới giữa (đang chờ
  // attestation), trôi tới cuối (đang relay), rồi mờ dần khi xong.
  const [coinVisible, setCoinVisible] = useState(false)
  const [coinPos, setCoinPos] = useState<'start' | 'mid' | 'end'>('start')
  useEffect(() => {
    if (state.status === 'waiting_attestation') {
      setCoinVisible(true)
      setCoinPos('start')
      const timer = setTimeout(() => setCoinPos('mid'), 250)
      return () => clearTimeout(timer)
    }
    if (state.status === 'relaying') {
      setCoinPos('end')
    }
    if (state.status === 'success') {
      setCoinVisible(false)
    }
  }, [state.status])

  const burnActive = state.status === 'checking_balance' || state.status === 'burning'
  const burnDone = ['waiting_attestation', 'relaying', 'success'].includes(state.status)
  const attestationActive = state.status === 'waiting_attestation'
  const attestationDone = ['relaying', 'success'].includes(state.status)
  const mintActive = state.status === 'relaying'
  const mintDone = state.status === 'success'

  const coinLeftPct = coinPos === 'start' ? 8 : coinPos === 'mid' ? 50 : 92

  return (
    <Modal maxWidth={480} cardRadius={22}>
      <style>{`
        @keyframes sabi-orb-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
      `}</style>

      <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: colors.textPrimary }}>
        {t('paymentModal.progress.title')}
      </p>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: colors.textSecondary }}>
        {t('paymentModal.progress.subtitle')}
      </p>

      <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
        <div
          style={{
            position: 'absolute',
            left: 44,
            right: 44,
            top: 24,
            height: 2,
            background: 'repeating-linear-gradient(90deg, #D6CFF0 0 7px, transparent 7px 13px)',
            zIndex: 1,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 11,
            left: `${coinLeftPct}%`,
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

        <Node
          icon="🔥"
          orbState={burnActive ? 'on' : burnDone ? 'done' : 'off'}
          label={t('paymentModal.progress.step_burn')}
          sub={burnDone && state.burnTxHash ? truncateHash(state.burnTxHash) : ''}
          subTone={burnDone ? 'ok' : 'muted'}
        />
        <Node
          icon="💲"
          orbState={attestationActive ? 'on' : attestationDone ? 'done' : 'off'}
          label={t('paymentModal.progress.step_attestation')}
          sub={attestationActive ? t('paymentModal.progress.node_attestation_waiting') : attestationDone ? t('paymentModal.progress.node_attestation_complete') : ''}
          subTone={attestationDone ? 'ok' : attestationActive ? 'active' : 'muted'}
        />
        <Node
          icon="⚡"
          orbState={mintActive ? 'on' : mintDone ? 'done' : 'off'}
          label={t('paymentModal.progress.step_mint')}
          sub={mintActive ? t('paymentModal.progress.node_mint_relaying') : mintDone && state.relayTxHash ? truncateHash(state.relayTxHash) : ''}
          subTone={mintDone ? 'ok' : mintActive ? 'active' : 'muted'}
        />
      </div>

      <div
        style={{
          background: '#111018',
          borderRadius: 12,
          padding: '6px 0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontSize: 11.5,
          maxHeight: 138,
          overflowY: 'auto',
        }}
      >
        {logs.map((entry, i) => (
          <div key={i} style={{ padding: '5px 14px', display: 'flex', gap: 10 }}>
            <span style={{ color: colors.primary, flexShrink: 0, fontSize: 10.5 }}>{entry.time}</span>
            <span style={{ color: LOG_TONE_COLOR[entry.tone] }}>{entry.text}</span>
          </div>
        ))}
      </div>

      {state.status === 'burning' && onCancelBurning && (
        <button
          onClick={onCancelBurning}
          style={{
            marginTop: 14,
            padding: '10px 22px',
            borderRadius: 50,
            fontSize: 13,
            fontWeight: 600,
            color: colors.textSecondary,
            background: '#F0EDF8',
            border: '1.5px solid #B0A8C8',
            cursor: 'pointer',
          }}
        >
          {t('bill.cancel_tx')}
        </button>
      )}
    </Modal>
  )
}

function Node({ icon, orbState, label, sub, subTone }: { icon: string; orbState: OrbState; label: string; sub: string; subTone: SubTone }) {
  const orbStyle: React.CSSProperties =
    orbState === 'done'
      ? { borderColor: colors.success, background: '#DFF5EA', animation: 'none' }
      : orbState === 'on'
      ? { borderColor: colors.primary, background: colors.selectedBg, animation: 'sabi-orb-pulse 1.2s infinite' }
      : { borderColor: '#D6CFF0', background: colors.background, animation: 'none' }
  const subColor = subTone === 'ok' ? colors.success : subTone === 'active' ? colors.primary : colors.textMuted

  return (
    <div style={{ textAlign: 'center', width: 88, position: 'relative', zIndex: 2 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          margin: '0 auto',
          border: '1.5px solid',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
          transition: 'all .4s',
          ...orbStyle,
        }}
      >
        {icon}
      </div>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: colors.textMuted, marginTop: 7 }}>{label}</div>
      <div style={{ fontSize: 9, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', marginTop: 2, minHeight: 11, color: subColor }}>
        {sub}
      </div>
    </div>
  )
}
