import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { colors } from '../styles/theme'
import { SabiLogo } from './SabiLogo'

const LAST_BILL_ID_KEY = 'sabi-last-bill-id'

// Lưu billId gần nhất đã tạo/xem — để tab "Chi tiết bill" ở trang / và /profile
// có chỗ để trỏ tới (thay vì biến mất khi không đứng trên trang /bill/[id]).
export function rememberLastBillId(billId: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LAST_BILL_ID_KEY, billId)
}

// Header + tab-bar dùng chung cho cả 3 trang thật (/, /bill/[id] hoặc /bill, /profile) —
// đúng cấu trúc sabi-ui-prototype-v8.html: thanh trắng (logo + ví) TÁCH RIÊNG khỏi
// hàng tab bên dưới (hàng tab nổi trên nền lavender của trang, không dính vào thanh trắng).
// Tab là link Next.js thật tới 3 route khác nhau — KHÔNG phải state JS gộp 1 trang
// như bản demo tĩnh, mỗi bill vẫn có URL riêng để share.
export function SabiHeader({ currentBillId }: { currentBillId?: string }) {
  const router = useRouter()
  const [lastBillId, setLastBillId] = useState<string | null>(null)

  useEffect(() => {
    if (currentBillId) {
      rememberLastBillId(currentBillId)
      return
    }
    setLastBillId(localStorage.getItem(LAST_BILL_ID_KEY))
  }, [currentBillId, router.asPath])

  const billTabId = currentBillId ?? lastBillId
  const billTabHref = billTabId ? `/bill/${billTabId}` : '/bill'
  const billTabLabel = billTabId ? `Chi tiết bill #${billTabId}` : 'Chi tiết bill'

  const isHome = router.pathname === '/'
  const isBillDetail = router.pathname === '/bill/[id]' || router.pathname === '/bill'
  const isProfile = router.pathname === '/profile'

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <header style={{ background: colors.surface, borderBottom: `1px solid ${colors.borderLight}` }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            maxWidth: 1080,
            margin: '0 auto',
            padding: '13px 24px',
            gap: 10,
          }}
        >
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <SabiLogo size={34} />
            <strong style={{ fontSize: 20, fontWeight: 800, color: colors.textPrimary }}>Sabi</strong>
          </Link>
          <ConnectButton />
        </div>
      </header>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '18px 16px 0' }}>
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: 5,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 99,
            maxWidth: '100%',
            overflowX: 'auto',
            boxShadow: `0 4px 20px ${colors.shadowColor}`,
          }}
        >
          <Tab href="/" active={isHome}>
            Tạo bill
          </Tab>
          <Tab href={billTabHref} active={isBillDetail}>
            {billTabLabel}
          </Tab>
          <Tab href="/profile" active={isProfile}>
            Hồ sơ
          </Tab>
        </div>
      </div>
    </div>
  )
}

function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        fontSize: 13.5,
        fontWeight: 600,
        padding: '9px 18px',
        borderRadius: 99,
        whiteSpace: 'nowrap',
        textDecoration: 'none',
        color: active ? '#fff' : colors.textSecondary,
        background: active ? colors.buttonPrimary : 'transparent',
      }}
    >
      {children}
    </Link>
  )
}
