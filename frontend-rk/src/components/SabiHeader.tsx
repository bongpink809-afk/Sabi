import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'next-i18next'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { colors } from '../styles/theme'
import { SabiLogo } from './SabiLogo'

// Cùng 3 URL đã verify sống bằng WebFetch ở fix C.3 (CrossChainStatus.tsx) —
// copy nguyên, không gõ lại tay để tránh verify trùng công / gõ sai ký tự.
const GAS_FAUCET_LINKS = [
  { label: 'Base Sepolia', href: 'https://www.alchemy.com/faucets/base-sepolia' },
  { label: 'Arbitrum Sepolia', href: 'https://www.alchemy.com/faucets/arbitrum-sepolia' },
  { label: 'Ethereum Sepolia', href: 'https://www.alchemy.com/faucets/ethereum-sepolia' },
] as const

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
  const { t } = useTranslation('common')
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
  const billTabLabel = billTabId ? t('nav.bill_detail_id', { id: billTabId }) : t('nav.bill_detail')

  const isHome = router.pathname === '/'
  const isBillDetail = router.pathname === '/bill/[id]' || router.pathname === '/bill'
  const isProfile = router.pathname === '/profile'

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      <header style={{ background: colors.surface, borderBottom: `1px solid ${colors.borderLight}` }}>
        <div
          className="sabi-header-inner"
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
          <div className="sabi-header-brand" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
              <SabiLogo size={34} />
              <strong style={{ fontSize: 20, fontWeight: 800, color: colors.textPrimary }}>Sabi</strong>
            </Link>
            <div className="sabi-locale-mobile">
              <LocaleSwitcher />
            </div>
          </div>
          <div className="sabi-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="sabi-locale-desktop">
              <LocaleSwitcher />
            </div>
            <FaucetMenu />
            <ConnectButton />
          </div>
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
            {t('nav.create_bill')}
          </Tab>
          <Tab href={billTabHref} active={isBillDetail}>
            {billTabLabel}
          </Tab>
          <Tab href="/profile" active={isProfile}>
            {t('nav.profile')}
          </Tab>
        </div>
      </div>
    </div>
  )
}

// Nút chuyển ngôn ngữ — cùng cơ chế fixed-position + neo theo rect.right như
// FaucetMenu (KHÔNG dùng window.innerWidth, tránh lặp lại bug dropdown dạt
// sang trái trên mobile đã sửa ở đó).
// TODO: bổ sung { code: 'zh', label: '中' }, { code: 'ko', label: '한' }, { code: 'ja', label: '日' } khi có bản dịch
const LOCALES = [
  { code: 'vi', label: 'VI' },
  { code: 'en', label: 'EN' },
] as const

function LocaleSwitcher() {
  const router = useRouter()
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const DROPDOWN_WIDTH = 120

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 8,
        left: Math.max(8, rect.right - DROPDOWN_WIDTH),
      })
    }
    setOpen((v) => !v)
  }

  const changeLocale = (locale: string) => {
    setOpen(false)
    router.push(router.pathname, router.asPath, { locale })
  }

  const currentLabel = LOCALES.find((l) => l.code === router.locale)?.label ?? 'EN'

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={handleToggle}
        title={t('language.button')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 99,
          border: `1px solid ${colors.border}`,
          background: open ? colors.backgroundSubtle : colors.surface,
          color: colors.textSecondary,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        🌐 {currentLabel}
      </button>

      {open && dropdownPos && (
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: DROPDOWN_WIDTH,
            maxWidth: 'calc(100vw - 16px)',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            boxShadow: `0 12px 30px ${colors.shadowColor}`,
            padding: 6,
            zIndex: 9999,
          }}
        >
          {LOCALES.map((l) => (
            <button
              key={l.code}
              onClick={() => changeLocale(l.code)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                borderRadius: 8,
                border: 'none',
                background: router.locale === l.code ? colors.backgroundSubtle : 'transparent',
                color: colors.textPrimary,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Nút Faucet cố định trên header — LUÔN hiện bất kể đã connect ví hay chưa
// (khác fix C.3 chỉ hiện khi rơi đúng lỗi insufficient_balance giữa lúc trả
// cross-chain — quá ẩn, user thật không tìm ra). 2 chỗ tồn tại song song,
// không thay thế nhau.
const FAUCET_DROPDOWN_WIDTH = 240

function FaucetMenu() {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const handleToggle = () => {
    if (!open && btnRef.current) {
      // Tính toạ độ tuyệt đối từ bounding rect của nút — thiết lập dropdown fixed position
      // để không bị cắt bởi overflow-x: hidden trên html/body (bug mobile).
      // Neo theo rect.right (đo trực tiếp trên DOM đã render, luôn đúng viewport thật)
      // thay vì window.innerWidth — trên mobile giá trị này có lúc lệch với viewport
      // hiển thị thật (layout viewport vs visual viewport chưa kịp đồng bộ), khiến
      // dropdown bị đẩy dạt hẳn sang trái, ra ngoài màn hình.
      const rect = btnRef.current.getBoundingClientRect()
      setDropdownPos({
        top: rect.bottom + 8,
        left: Math.max(8, rect.right - FAUCET_DROPDOWN_WIDTH),
      })
    }
    setOpen((v) => !v)
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        ref={btnRef}
        onClick={handleToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          borderRadius: 99,
          border: `1px solid ${colors.border}`,
          background: open ? colors.backgroundSubtle : colors.surface,
          color: colors.textSecondary,
          fontSize: 13.5,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {t('faucet.button')}
      </button>

      {open && dropdownPos && (
        <div
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: FAUCET_DROPDOWN_WIDTH,
            maxWidth: 'calc(100vw - 16px)',
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 12,
            boxShadow: `0 12px 30px ${colors.shadowColor}`,
            padding: 10,
            zIndex: 9999,
          }}
        >
          <FaucetSectionLabel>{t('faucet.usdc_label')}</FaucetSectionLabel>
          <FaucetLink href="https://faucet.circle.com" onNavigate={() => setOpen(false)}>
            {t('faucet.usdc_link')}
          </FaucetLink>

          <FaucetSectionLabel style={{ marginTop: 10 }}>{t('faucet.gas_label')}</FaucetSectionLabel>
          {GAS_FAUCET_LINKS.map((chain) => (
            <FaucetLink key={chain.href} href={chain.href} onNavigate={() => setOpen(false)}>
              {chain.label}
            </FaucetLink>
          ))}

          <p style={{ fontSize: 10.5, color: colors.textMuted, marginTop: 8, padding: '0 6px', lineHeight: 1.5 }}>
            {t('faucet.limit_note')}
          </p>
        </div>
      )}
    </div>
  )
}

function FaucetSectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, color: colors.textMuted, letterSpacing: 0.5, padding: '4px 6px', ...style }}>
      {children}
    </div>
  )
}

function FaucetLink({ href, onNavigate, children }: { href: string; onNavigate: () => void; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      style={{
        display: 'block',
        padding: '8px 6px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        color: colors.textPrimary,
        textDecoration: 'none',
      }}
    >
      {children} ↗
    </a>
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
