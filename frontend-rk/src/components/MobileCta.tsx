import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { colors, radius } from '../styles/theme'

// QR trỏ về origin thật của trang đang chạy (localhost lúc dev, domain thật lúc deploy)
// — không hard-code domain placeholder như bản prototype tĩnh.
export function MobileCta() {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)

  useEffect(() => {
    QRCode.toDataURL(window.location.origin, { width: 96, margin: 1, color: { dark: '#1B1926', light: '#FFFFFF' } })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        flexWrap: 'wrap',
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        padding: 24,
        marginTop: 34,
        boxShadow: `0 8px 26px ${colors.shadowColor}`,
      }}
    >
      <div>
        <h3 style={{ fontSize: 17, fontWeight: 600, marginBottom: 6, color: colors.textPrimary }}>
          Sabi chạy mượt trên điện thoại
        </h3>
        <p style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.6, maxWidth: 400, margin: 0 }}>
          Không cần cài app riêng — mở thẳng trên trình duyệt di động (Chrome/Safari), kết nối ví qua
          MetaMask Mobile hoặc WalletConnect như trên máy tính.
        </p>
      </div>
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        {qrDataUrl && <img src={qrDataUrl} width={96} height={96} alt="QR mở Sabi trên điện thoại" style={{ display: 'block' }} />}
        <span style={{ display: 'block', fontSize: 11, color: colors.textSecondary, marginTop: 8, maxWidth: 110 }}>
          Quét để mở Sabi trên điện thoại
        </span>
      </div>
    </div>
  )
}
