import { useMemo } from 'react'
import { useTranslation } from 'next-i18next'
import { colors } from '../styles/theme'
import { truncateHash } from '../lib/format'

const CONFETTI_COLORS = ['#7C6AEF', '#17A268', '#D98E12', '#9A8BFF', '#4ADE97', '#E8B54A', '#17151F']
const CONFETTI_COUNT = 40

// Modal 3 — success. Không dùng component Modal chung vì confetti cần phủ
// toàn viewport, bị clip mất nếu đặt trong card có overflowY:auto.
export function PaymentSuccessModal({ txHash, onClose }: { txHash: `0x${string}` | undefined; onClose: () => void }) {
  const { t } = useTranslation('common')

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

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(23, 21, 31, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <style>{`
        @keyframes sabi-confetti-fall {
          to { transform: translateY(90vh) rotate(720deg); opacity: .08; }
        }
        @keyframes sabi-check-pop {
          from { transform: scale(0); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @keyframes sabi-check-draw {
          to { stroke-dashoffset: 0; }
        }
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
              animation: `sabi-confetti-fall ${p.duration}s linear ${p.delay}s 1 forwards`,
            }}
          />
        ))}
      </div>

      <div
        style={{
          position: 'relative',
          background: colors.surface,
          borderRadius: 22,
          padding: '32px 24px',
          width: '100%',
          maxWidth: 540,
          textAlign: 'center',
          boxShadow: `0 8px 32px ${colors.shadowColor}`,
        }}
      >
        <div
          style={{
            width: 68,
            height: 68,
            borderRadius: '50%',
            border: `2.5px solid ${colors.success}`,
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 14px',
            animation: 'sabi-check-pop 0.6s cubic-bezier(.34,1.56,.64,1)',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path
              d="M7 17 L13 23 L25 9"
              stroke={colors.success}
              strokeWidth={3.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{
                strokeDasharray: 28,
                strokeDashoffset: 28,
                animation: 'sabi-check-draw 0.35s ease-out 0.3s forwards',
              }}
            />
          </svg>
        </div>

        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: colors.textPrimary }}>
          {t('paymentModal.success.title')}
        </h2>
        <p style={{ margin: '8px 0 18px', fontSize: 13, color: colors.textSecondary }}>
          {t('paymentModal.success.subtitle')}
        </p>

        {txHash && (
          <a
            href={`https://testnet.arcscan.app/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginBottom: 20,
              color: colors.primary,
              fontSize: 13,
              textDecoration: 'underline',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {t('paymentModal.success.arcscan_link', { hash: truncateHash(txHash) })}
          </a>
        )}

        <div>
          <button
            onClick={onClose}
            style={{
              display: 'inline-block',
              padding: '11px 32px',
              borderRadius: 50,
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: colors.buttonPrimary,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t('paymentModal.success.view_bill_button')}
          </button>
        </div>
      </div>
    </div>
  )
}
