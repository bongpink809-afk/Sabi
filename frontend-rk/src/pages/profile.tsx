import { useAccount, usePublicClient } from 'wagmi'
import type { NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'
import { formatUnits, toFunctionSelector } from 'viem'
import { colors, radius } from '../styles/theme'
import { SabiHeader } from '../components/SabiHeader'
import { arcTestnet } from '../wagmi'
import { useProfileData, useBillsProgress, BillProgress, CreatedBill, PaymentMade } from '../hooks/useProfileData'

const PAGE_SIZE = 5

// Chỉ 2 khả năng thật: trả trực tiếp (payShare/paySlot, msg.sender = payer) hay
// trả cross-chain (payCrossChain, payer giải mã từ message CCTP) — phân biệt bằng
// function selector của tx đã emit event, không suy đoán, không cần chain nguồn
// chính xác (dữ liệu đó không tồn tại lại được ở phía Arc sau khi relay xong).
const PAY_CROSSCHAIN_SELECTOR = toFunctionSelector('function payCrossChain(bytes message, bytes attestation)')

// Tên bill chỉ lưu ở frontend theo billId (contract không lưu) — đọc lại
// đúng key đã dùng ở create.tsx/bill/[id].tsx, fallback "Bill #n" nếu chưa có
function getBillTitle(billId: bigint): string {
  if (typeof window === 'undefined') return `Bill #${billId.toString()}`
  return localStorage.getItem(`sabi-bill-${billId.toString()}-title`) ?? `Bill #${billId.toString()}`
}

const Profile: NextPage = () => {
  const { address, isConnected } = useAccount()
  const { billsCreated, paymentsMade, totalContributed, paidShareCountByBillId, isLoading } = useProfileData(address)
  const [createdPage, setCreatedPage] = useState(0)
  const [paidPage, setPaidPage] = useState(0)

  // Tên tự đặt cho hồ sơ của chính mình — chỉ lưu local trên máy này theo địa chỉ ví,
  // contract không có khái niệm "tên người dùng". Cùng cơ chế đã dùng cho tên người
  // tham gia/người góp ở bill/[id].tsx.
  const [profileName, setProfileName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  useEffect(() => {
    if (!address) return
    const saved = localStorage.getItem(`sabi-profile-name-${address.toLowerCase()}`)
    setProfileName(saved ?? '')
  }, [address])
  const saveProfileName = () => {
    if (!address || !nameDraft.trim()) return
    const name = nameDraft.trim()
    localStorage.setItem(`sabi-profile-name-${address.toLowerCase()}`, name)
    setProfileName(name)
  }

  // Ảnh đại diện — chọn ảnh trên máy, thu nhỏ + crop vuông qua canvas, XEM TRƯỚC
  // rồi mới bấm "Lưu ảnh" mới thật sự ghi vào localStorage (avatarDraftUrl khác
  // avatarUrl để tách rõ 2 bước, không tự lưu ngay khi chọn file). Chỉ lưu local,
  // không upload lên đâu cả — giống mọi dữ liệu cá nhân khác trong app này.
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarDraftUrl, setAvatarDraftUrl] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!address) return
    const saved = localStorage.getItem(`sabi-profile-avatar-${address.toLowerCase()}`)
    setAvatarUrl(saved ?? '')
    setAvatarDraftUrl('')
  }, [address])

  const handleAvatarFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const SIZE = 128
        const canvas = document.createElement('canvas')
        canvas.width = SIZE
        canvas.height = SIZE
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        // Crop vuông ở giữa ảnh gốc rồi scale về đúng SIZE — tránh méo ảnh
        const side = Math.min(img.width, img.height)
        const sx = (img.width - side) / 2
        const sy = (img.height - side) / 2
        ctx.drawImage(img, sx, sy, side, side, 0, 0, SIZE, SIZE)
        setAvatarDraftUrl(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  const saveAvatar = () => {
    if (!address || !avatarDraftUrl) return
    localStorage.setItem(`sabi-profile-avatar-${address.toLowerCase()}`, avatarDraftUrl)
    setAvatarUrl(avatarDraftUrl)
    setAvatarDraftUrl('')
  }

  const cancelAvatarDraft = () => setAvatarDraftUrl('')

  const totalCreatedPages = Math.max(1, Math.ceil(billsCreated.length / PAGE_SIZE))
  const totalPaidPages = Math.max(1, Math.ceil(paymentsMade.length / PAGE_SIZE))
  const currentCreatedPage = Math.min(createdPage, totalCreatedPages - 1)
  const currentPaidPage = Math.min(paidPage, totalPaidPages - 1)

  const visibleCreated = billsCreated.slice(currentCreatedPage * PAGE_SIZE, currentCreatedPage * PAGE_SIZE + PAGE_SIZE)
  const visiblePaid = paymentsMade.slice(currentPaidPage * PAGE_SIZE, currentPaidPage * PAGE_SIZE + PAGE_SIZE)

  // Badge "ĐANG THU"/"ĐÃ ĐỦ" — chỉ tính cho các bill đang hiện (multicall 1 lần,
  // không tính hết toàn bộ billsCreated để tránh phình request khi list dài)
  const billsProgress = useBillsProgress(
    visibleCreated.map((b) => b.billId),
    paidShareCountByBillId
  )

  return (
    <div style={wrap}>
      <Head>
        <title>Hồ sơ — Sabi</title>
      </Head>

      <SabiHeader />

      <main style={{ padding: '24px 16px 40px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          {!isConnected || !address ? (
            <div
              style={{
                maxWidth: 560,
                margin: '0 auto',
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.card,
                padding: 24,
                textAlign: 'center',
                color: colors.textSecondary,
                fontSize: 14,
              }}
            >
              Kết nối ví để xem hồ sơ của bạn.
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radius.card,
                  padding: 20,
                  marginBottom: 22,
                  flexWrap: 'wrap',
                  boxShadow: `0 8px 26px ${colors.shadowColor}`,
                }}
              >
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleAvatarFile(file)
                    e.target.value = ''
                  }}
                />
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: '50%',
                      display: 'grid',
                      placeItems: 'center',
                      background: colors.badgeBg,
                      color: colors.badgeText,
                      fontWeight: 700,
                      fontSize: 22,
                      fontFamily: 'sans-serif',
                      overflow: 'hidden',
                    }}
                  >
                    {avatarDraftUrl || avatarUrl ? (
                      <img
                        src={avatarDraftUrl || avatarUrl}
                        alt="Ảnh đại diện"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      (profileName ? profileName.charAt(0) : address.slice(2, 3)).toUpperCase()
                    )}
                  </div>
                  {/* Nút camera hiện rõ ra ngoài — trước đây bấm thẳng vào avatar mới
                      mở được chọn ảnh, không ai biết bấm vào đâu */}
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    title="Đổi ảnh đại diện"
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: colors.buttonPrimary,
                      color: '#fff',
                      border: `2px solid ${colors.surface}`,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 11,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    📷
                  </button>
                </div>
                <div style={{ flex: 1, minWidth: 160 }}>
                  {avatarDraftUrl && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 12, color: colors.textSecondary }}>Ảnh mới đã chọn —</span>
                      <button
                        onClick={saveAvatar}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#fff',
                          background: colors.buttonPrimary,
                          border: 'none',
                          borderRadius: 6,
                          padding: '5px 12px',
                          cursor: 'pointer',
                        }}
                      >
                        Lưu ảnh
                      </button>
                      <button
                        onClick={cancelAvatarDraft}
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: colors.textSecondary,
                          background: 'none',
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          padding: '5px 12px',
                          cursor: 'pointer',
                        }}
                      >
                        Huỷ
                      </button>
                    </div>
                  )}
                  {profileName ? (
                    <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary }}>{profileName}</div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder="Đặt tên cho hồ sơ này"
                        style={{
                          fontSize: 13,
                          padding: '6px 10px',
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          outline: 'none',
                          maxWidth: 220,
                        }}
                      />
                      <button
                        onClick={saveProfileName}
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
                  <div
                    style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                      fontSize: 12.5,
                      color: colors.textSecondary,
                      marginTop: 4,
                    }}
                  >
                    {address.slice(0, 6)}...{address.slice(-4)}
                  </div>
                  <div style={{ fontSize: 11.5, color: colors.textMuted, marginTop: 2 }}>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 22, marginLeft: 'auto' }}>
                  <Stat label="bill đã tạo" value={billsCreated.length} />
                  <Stat label="lần đã trả" value={paymentsMade.length} />
                  <Stat label="USDC đã góp" value={formatUnits(totalContributed, 6)} />
                </div>
              </div>

              {isLoading && billsCreated.length === 0 && paymentsMade.length === 0 && (
                <p style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
                  Đang tải lịch sử on-chain...
                </p>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
                <Section title="Bill đã tạo" sub="Bấm vào để mở trang chi tiết">
                  {!isLoading && billsCreated.length === 0 && <EmptyRow text="Chưa tạo bill nào." />}
                  {visibleCreated.map((bill) => (
                    <CreatedBillRow key={bill.txHash} bill={bill} progress={billsProgress[bill.billId.toString()]} />
                  ))}
                  {totalCreatedPages > 1 && (
                    <Pagination page={currentCreatedPage} totalPages={totalCreatedPages} onChange={setCreatedPage} />
                  )}
                </Section>

                <Section title="Bill đã trả" sub="Mỗi dòng gắn tx hash thật — bấm mở arcscan">
                  {!isLoading && paymentsMade.length === 0 && <EmptyRow text="Chưa trả bill nào." />}
                  {visiblePaid.map((p, i) => (
                    <PaymentRow key={`${p.txHash}-${i}`} payment={p} />
                  ))}
                  {totalPaidPages > 1 && (
                    <Pagination page={currentPaidPage} totalPages={totalPaidPages} onChange={setPaidPage} />
                  )}
                </Section>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 20, fontWeight: 700, color: colors.textPrimary }}>
        {value}
      </div>
      <div style={{ fontSize: 11.5, color: colors.textSecondary }}>{label}</div>
    </div>
  )
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.card,
        padding: 20,
        boxShadow: `0 8px 26px ${colors.shadowColor}`,
      }}
    >
      <h3 style={{ fontSize: 16.5, fontWeight: 600, color: colors.textPrimary, marginBottom: 4 }}>{title}</h3>
      <p style={{ fontSize: 12.5, color: colors.textSecondary, marginBottom: 16 }}>{sub}</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p style={{ color: colors.textMuted, fontSize: 12 }}>{text}</p>
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (page: number) => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 4 }}>
      <button
        onClick={() => onChange(Math.max(0, page - 1))}
        disabled={page === 0}
        style={{
          background: 'none',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
          color: page === 0 ? colors.textMuted : colors.textSecondary,
          cursor: page === 0 ? 'not-allowed' : 'pointer',
        }}
      >
        ← Trước
      </button>
      <span style={{ fontSize: 12, color: colors.textSecondary }}>
        Trang {page + 1}/{totalPages}
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        disabled={page >= totalPages - 1}
        style={{
          background: 'none',
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: '6px 12px',
          fontSize: 13,
          fontWeight: 600,
          color: page >= totalPages - 1 ? colors.textMuted : colors.textSecondary,
          cursor: page >= totalPages - 1 ? 'not-allowed' : 'pointer',
        }}
      >
        Sau →
      </button>
    </div>
  )
}

function ModeBadge({ mode }: { mode: number }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        padding: '3px 8px',
        borderRadius: 6,
        background: colors.badgeBg,
        color: colors.badgeText,
        whiteSpace: 'nowrap',
      }}
    >
      {mode === 0 ? 'ASSIGNED' : 'OPEN-SLOT'}
    </span>
  )
}

function CreatedBillRow({ bill, progress }: { bill: CreatedBill; progress: BillProgress | undefined }) {
  const router = useRouter()
  const href = `/bill/${bill.billId.toString()}`

  // Prefetch ngay khi danh sách render — bấm vào nhảy liền, không chờ Next.js
  // compile route lần đầu (dev mode compile route theo yêu cầu, gây cảm giác "hơi lâu")
  useEffect(() => {
    router.prefetch(href)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href])

  const isDone = progress !== undefined && progress.totalCount > 0 && progress.paidCount >= progress.totalCount

  return (
    <Link
      href={href}
      className="bill-card"
      style={{
        display: 'block',
        padding: '12px 14px',
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        textDecoration: 'none',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{getBillTitle(bill.billId)}</span>
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
          #{bill.billId.toString()}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
        <ModeBadge mode={bill.mode} />
        {progress !== undefined && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.5,
              padding: '3px 8px',
              borderRadius: 6,
              whiteSpace: 'nowrap',
              background: isDone ? colors.successBg : colors.warningBg,
              color: isDone ? colors.success : colors.warning,
            }}
          >
            {isDone ? 'ĐÃ ĐỦ' : 'ĐANG THU'}
          </span>
        )}
      </div>
      <div style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
        {progress ? `${progress.paidCount}/${progress.totalCount} đã trả · ` : ''}
        {formatUnits(bill.totalAmount, 6)} USDC
      </div>

      <style jsx>{`
        :global(a.bill-card) {
          transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }
        :global(a.bill-card:hover) {
          border-color: ${colors.primary} !important;
          box-shadow: 0 10px 24px ${colors.shadowColor};
          transform: translateY(-2px);
        }
      `}</style>
    </Link>
  )
}

function PaymentRow({ payment }: { payment: PaymentMade }) {
  const router = useRouter()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const [method, setMethod] = useState<'direct' | 'crosschain' | null>(null)
  const href = `/bill/${payment.billId.toString()}`

  // Prefetch ngay khi danh sách render — lý do giống CreatedBillRow ở trên
  useEffect(() => {
    router.prefetch(href)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href])

  // "Trả ở đâu" — chỉ xác định được TRỰC TIẾP hay CROSS-CHAIN bằng cách so
  // function selector của tx đã emit event (payShare/paySlot vs payCrossChain).
  // KHÔNG hiện tên chain nguồn cụ thể (Base/Arbitrum/Ethereum Sepolia) vì dữ liệu
  // đó không còn tồn tại lại được ở phía Arc sau khi relay xong — tránh bịa.
  useEffect(() => {
    if (!publicClient) return
    let cancelled = false
    publicClient
      .getTransaction({ hash: payment.txHash })
      .then((tx) => {
        if (cancelled) return
        setMethod(tx.input.toLowerCase().startsWith(PAY_CROSSCHAIN_SELECTOR) ? 'crosschain' : 'direct')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [payment.txHash, publicClient])

  const description = method === 'crosschain' ? 'cross-chain' : method === 'direct' ? 'trực tiếp trên Arc' : null

  return (
    <div
      className="bill-card"
      onClick={() => router.push(href)}
      style={{
        padding: '12px 14px',
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{getBillTitle(payment.billId)}</span>
        <span style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
          #{payment.billId.toString()}
        </span>
      </div>
      <div style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
        {formatUnits(payment.amount, 6)} USDC{description ? ` · ${description}` : ''}
      </div>
<a
        href={`https://testnet.arcscan.app/tx/${payment.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'block',
          marginTop: 3,
          color: colors.primary,
          fontSize: 10,
          textDecoration: 'underline',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        }}
      >
        {payment.txHash.slice(0, 8)}…{payment.txHash.slice(-6)} ↗
      </a>

      <style jsx>{`
        .bill-card {
          transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
        }
        .bill-card:hover {
          border-color: ${colors.primary} !important;
          box-shadow: 0 10px 24px ${colors.shadowColor};
          transform: translateY(-2px);
        }
      `}</style>
    </div>
  )
}

const wrap: React.CSSProperties = { minHeight: '100vh', fontFamily: 'sans-serif', background: colors.background }

export default Profile
