import { useEffect, useState } from 'react'
import { useTranslation } from 'next-i18next'
import { colors } from '../styles/theme'

// Bottom sheet chia sẻ bill — 2 biến thể tuỳ thiết bị:
// - Desktop: chỉ Telegram, Mail (2 URL scheme thật pre-fill được text+link) + 1 nút
//   "Copy link" chung, vì trên desktop navigator.share() không dùng được (xem
//   bill/[id].tsx — Windows tự mở share dialog riêng của OS, không kiểm soát được).
// - Mobile fallback (trình duyệt mobile không hỗ trợ navigator.share): đầy đủ hơn —
//   thêm Telegram, WhatsApp, Discord, X, Messenger, Zalo, Mail. Discord/X/Messenger/Zalo
//   không có URL scheme public để pre-fill nên dùng chung 1 hành động: copy link.
export function ShareBillSheet({
  billUrl,
  shareText,
  subtitle,
  isMobile,
  onClose,
}: {
  billUrl: string
  shareText: string
  subtitle: string
  isMobile: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('common')
  const [show, setShow] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const handleClose = () => {
    setShow(false)
    setTimeout(onClose, 280)
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 1600)
  }

  const openTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(billUrl)}&text=${encodeURIComponent(shareText)}`
    window.open(url, '_blank')
    showToast(t('bill.share_toast_opening', { platform: 'Telegram' }))
  }

  const openWhatsapp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${billUrl}`)}`
    window.open(url, '_blank')
    showToast(t('bill.share_toast_opening', { platform: 'WhatsApp' }))
  }

  const openEmail = () => {
    const url = `mailto:?subject=${encodeURIComponent(t('bill.share_email_subject'))}&body=${encodeURIComponent(`${shareText}\n\n${billUrl}`)}`
    window.location.href = url
    showToast(t('bill.share_toast_opening', { platform: 'Email' }))
  }

  const copyForPlatform = (platform: string) => {
    navigator.clipboard.writeText(billUrl)
    showToast(t('bill.share_toast_copied', { platform }))
  }

  const copyLink = () => {
    navigator.clipboard.writeText(billUrl)
    showToast(t('bill.share_toast_copied_link'))
  }

  return (
    <>
      <div className={`sbs-overlay ${show ? 'show' : ''}`} onClick={handleClose} />

      <div className={`sbs-sheet ${show ? 'show' : ''}`}>
        <div className="sbs-handle" />
        <div className="sbs-title">{t('bill.share_sheet_title')}</div>
        <div className="sbs-subtitle">{subtitle}</div>

        <div className="sbs-row">
          <button className="sbs-item" onClick={openTelegram}>
            <span className="sbs-icon" style={{ background: '#29A9EA' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M21.5 3.5L2.5 11l6 2.3M21.5 3.5L18 20.5l-9.2-7.2M21.5 3.5L8.8 13.3m0 0L8 19l2.7-3.4" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sbs-item-label">Telegram</span>
          </button>

          {isMobile && (
            <button className="sbs-item" onClick={openWhatsapp}>
              <span className="sbs-icon" style={{ background: '#25D366' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M17 14.4c-.3-.15-1.7-.85-2-.95-.27-.1-.46-.15-.66.15-.2.3-.76.95-.93 1.14-.17.2-.34.22-.63.08-.3-.15-1.24-.46-2.36-1.46-.87-.78-1.46-1.74-1.63-2.03-.17-.3-.02-.46.13-.6.13-.14.3-.34.44-.5.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.66-1.6-.9-2.18-.24-.58-.48-.5-.66-.5h-.56c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.87 1.22 3.07c.15.2 2.1 3.2 5.1 4.5.71.3 1.27.49 1.7.62.72.23 1.36.2 1.88.12.57-.09 1.7-.7 1.94-1.36.24-.67.24-1.24.17-1.36-.07-.12-.27-.2-.57-.35z" fill="white" />
                  <path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.5A10 10 0 1012 2z" stroke="white" strokeWidth={1.3} />
                </svg>
              </span>
              <span className="sbs-item-label">WhatsApp</span>
            </button>
          )}

          {isMobile && (
            <button className="sbs-item" onClick={() => copyForPlatform('Discord')}>
              <span className="sbs-icon" style={{ background: '#5865F2' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M8.5 8.5c2.2-1 4.8-1 7 0M7.5 15.5c2.8 1.2 6.2 1.2 9 0M9 12.2c0 .7-.5 1.3-1.2 1.3s-1.2-.6-1.2-1.3.5-1.3 1.2-1.3 1.2.6 1.2 1.3zm8.4 0c0 .7-.5 1.3-1.2 1.3s-1.2-.6-1.2-1.3.5-1.3 1.2-1.3 1.2.6 1.2 1.3z" stroke="white" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="sbs-item-label">Discord</span>
            </button>
          )}

          {isMobile && (
            <button className="sbs-item" onClick={() => copyForPlatform('X')}>
              <span className="sbs-icon" style={{ background: colors.paperInk }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M4 4l16 16M20 4L4 20" stroke="white" strokeWidth={1.8} strokeLinecap="round" />
                </svg>
              </span>
              <span className="sbs-item-label">X</span>
            </button>
          )}

          {isMobile && (
            <button className="sbs-item" onClick={() => copyForPlatform('Messenger')}>
              <span className="sbs-icon" style={{ background: '#0084FF' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2C6.5 2 2 6.1 2 11.2c0 2.9 1.5 5.5 3.8 7.2V22l3.5-1.9c1 .3 2.1.4 3.2.4 5.5 0 10-4.1 10-9.2S17.5 2 12 2z" stroke="white" strokeWidth={1.4} />
                  <path d="M7 12.5l3.3-3.5 2.5 2 3.2-3.5-3.3 3.5-2.5-2-3.2 3.5z" fill="white" />
                </svg>
              </span>
              <span className="sbs-item-label">Messenger</span>
            </button>
          )}

          {isMobile && (
            <button className="sbs-item" onClick={() => copyForPlatform('Zalo')}>
              <span className="sbs-icon" style={{ background: '#0068FF' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M8 9h5l-5 6h5" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 9v6M17 9v4a2 2 0 002 2" stroke="white" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              </span>
              <span className="sbs-item-label">Zalo</span>
            </button>
          )}

          <button className="sbs-item" onClick={openEmail}>
            <span className="sbs-icon" style={{ background: colors.paperInk }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <rect x="3" y="5" width="18" height="14" rx="2" stroke="white" strokeWidth={1.6} />
                <path d="M4 6.5l8 6 8-6" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="sbs-item-label">Mail</span>
          </button>

          {!isMobile && (
            <button className="sbs-item" onClick={copyLink}>
              <span className="sbs-icon" style={{ background: colors.primary }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="8" y="8" width="11" height="11" rx="2" stroke="white" strokeWidth={1.6} />
                  <path d="M5 15V6a1 1 0 011-1h9" stroke="white" strokeWidth={1.6} strokeLinecap="round" />
                </svg>
              </span>
              <span className="sbs-item-label">{t('bill.share_copy_link_label')}</span>
            </button>
          )}
        </div>

        {isMobile && <div className="sbs-fallback-note">{t('bill.share_fallback_note')}</div>}

        <button className="sbs-cancel" onClick={handleClose}>
          {t('bill.share_cancel')}
        </button>
      </div>

      <div className={`sbs-toast ${toast ? 'show' : ''}`}>{toast}</div>

      <style jsx>{`
        .sbs-overlay {
          position: fixed;
          inset: 0;
          background: rgba(11, 31, 58, 0.45);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s ease;
          z-index: 1000;
        }
        .sbs-overlay.show {
          opacity: 1;
          pointer-events: auto;
        }
        .sbs-sheet {
          position: fixed;
          left: 50%;
          bottom: 0;
          transform: translate(-50%, 100%);
          width: 100%;
          max-width: 420px;
          background: ${colors.surface};
          border-radius: 22px 22px 0 0;
          padding: 10px 22px 26px;
          transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
          z-index: 1001;
          box-shadow: 0 -12px 40px rgba(11, 31, 58, 0.18);
        }
        .sbs-sheet.show {
          transform: translate(-50%, 0);
        }
        .sbs-handle {
          width: 36px;
          height: 4px;
          background: ${colors.border};
          border-radius: 999px;
          margin: 8px auto 16px;
        }
        .sbs-title {
          font-size: 15px;
          font-weight: 700;
          color: ${colors.textPrimary};
          margin-bottom: 2px;
        }
        .sbs-subtitle {
          font-size: 12px;
          color: ${colors.textSecondary};
          margin-bottom: 18px;
        }
        .sbs-row {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .sbs-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 64px;
          background: none;
          border: none;
          cursor: pointer;
          font-family: inherit;
          padding: 0;
        }
        .sbs-icon {
          width: 46px;
          height: 46px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .sbs-item-label {
          font-size: 10.5px;
          font-weight: 600;
          color: ${colors.textPrimary};
          text-align: center;
        }
        .sbs-fallback-note {
          font-size: 11px;
          color: ${colors.textSecondary};
          margin-bottom: 18px;
          line-height: 1.5;
        }
        .sbs-cancel {
          width: 100%;
          padding: 13px;
          border-radius: 12px;
          border: 1px solid ${colors.border};
          background: ${colors.background};
          color: ${colors.textPrimary};
          font-family: inherit;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .sbs-toast {
          position: fixed;
          bottom: 28px;
          left: 50%;
          transform: translateX(-50%) translateY(20px);
          background: ${colors.paperInk};
          color: white;
          font-size: 13px;
          font-weight: 500;
          padding: 12px 20px;
          border-radius: 12px;
          opacity: 0;
          pointer-events: none;
          transition: all 0.25s ease;
          white-space: nowrap;
          z-index: 1002;
        }
        .sbs-toast.show {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      `}</style>
    </>
  )
}
