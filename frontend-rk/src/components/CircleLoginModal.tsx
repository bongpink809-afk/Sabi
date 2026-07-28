import { useEffect, useState } from 'react'
import { useTranslation } from 'next-i18next'
import { Modal } from './Modal'
import { colors } from '../styles/theme'
import { useCircleWallet } from '../contexts/CircleWalletContext'

// Modal "Sign in with email" — chỉ có input email + nút gửi. Sau khi gửi,
// Circle tự mở iframe riêng (OTP rồi đặt PIN) đè lên trên, modal này chỉ hiện
// dòng chờ. Tự đóng khi đăng nhập xong (status === 'ready').
export function CircleLoginModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common')
  const { status, error, startEmailLogin } = useCircleWallet()
  const [email, setEmail] = useState('')

  useEffect(() => {
    if (status === 'ready') onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const isBusy = status === 'awaiting_otp' || status === 'awaiting_wallet_setup'

  const handleSubmit = () => {
    if (!email.trim() || isBusy) return
    startEmailLogin(email.trim())
  }

  return (
    <Modal onClose={isBusy ? undefined : onClose} maxWidth={420}>
      <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: colors.textPrimary }}>
        {t('circle.modal_title')}
      </p>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: colors.textSecondary }}>
        {t('circle.modal_subtitle')}
      </p>

      <input
        type="email"
        placeholder={t('circle.email_placeholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isBusy}
        style={{
          width: '100%',
          background: colors.surface,
          color: colors.textPrimary,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '10px 14px',
          fontSize: 14,
          marginBottom: 12,
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />

      {isBusy && (
        <p style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 12 }}>
          {t('circle.waiting_hint')}
        </p>
      )}
      {status === 'error' && error && (
        <p style={{ fontSize: 12.5, color: colors.danger, marginBottom: 12 }}>{error}</p>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {!isBusy && (
          <button
            onClick={onClose}
            style={{
              padding: '10px 22px',
              borderRadius: 50,
              fontSize: 13.5,
              fontWeight: 600,
              cursor: 'pointer',
              background: '#F0EDF8',
              color: colors.textSecondary,
              border: '1.5px solid #B0A8C8',
            }}
          >
            {t('circle.cancel')}
          </button>
        )}
        <button
          onClick={handleSubmit}
          disabled={isBusy || !email.trim()}
          style={{
            padding: '10px 22px',
            borderRadius: 50,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: isBusy ? 'not-allowed' : 'pointer',
            background: isBusy ? colors.textMuted : colors.buttonPrimary,
            color: '#fff',
            border: 'none',
          }}
        >
          {isBusy ? t('circle.submitting') : t('circle.submit')}
        </button>
      </div>
    </Modal>
  )
}
