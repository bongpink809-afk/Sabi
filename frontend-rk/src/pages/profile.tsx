import { useAccount, usePublicClient } from 'wagmi'
import type { NextPage, GetServerSideProps } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'next-i18next'
import { serverSideTranslations } from 'next-i18next/serverSideTranslations'
import { formatUnits, toFunctionSelector } from 'viem'
import { colors, radius } from '../styles/theme'
import { SabiHeader } from '../components/SabiHeader'
import { SabiLogo } from '../components/SabiLogo'
import { arcTestnet } from '../wagmi'
import { useProfileData, useBillsProgress, BillProgress, CreatedBill, PaymentMade } from '../hooks/useProfileData'
import { withRetry429 } from '../lib/eventScan'
import { useUserProfileSync, useBillTitlesSync, saveProfileName as firebaseSaveProfileName, saveAvatar as firebaseSaveAvatar } from '../hooks/useFirebaseSync'

export const getServerSideProps: GetServerSideProps = async ({ locale }) => ({
  props: { ...(await serverSideTranslations(locale ?? 'en', ['common'])) },
})

const PAGE_SIZE = 5

// Chỉ 2 khả năng thật: trả trực tiếp (payShare/paySlot, msg.sender = payer) hay
// trả cross-chain (payCrossChain, payer giải mã từ message CCTP) — phân biệt bằng
// function selector của tx đã emit event, không suy đoán, không cần chain nguồn
// chính xác (dữ liệu đó không tồn tại lại được ở phía Arc sau khi relay xong).
const PAY_CROSSCHAIN_SELECTOR = toFunctionSelector('function payCrossChain(bytes message, bytes attestation)')

// Tên bill đọc từ localStorage (nếu có) hoặc Firestore (qua billTitles state)
function getBillTitleFromMap(billId: bigint, firestoreTitles: Record<string, string>): string {
  const id = billId.toString()
  // Ƭu tiên Firestore (mới nhất), fallback localStorage, fallback "Bill #n"
  if (firestoreTitles[id]) return firestoreTitles[id]
  if (typeof window !== 'undefined') {
    const local = localStorage.getItem(`sabi-bill-${id}-title`)
    if (local) return local
  }
  return `Bill #${id}`
}

const Profile: NextPage = () => {
  const { t } = useTranslation('common')
  const { address, isConnected } = useAccount()
  const { billsCreated, paymentsMade, totalContributed, isLoading, isError, refetch } = useProfileData(address)
  const [createdPage, setCreatedPage] = useState(0)
  const [paidPage, setPaidPage] = useState(0)

  // Tên tự đặt cho hồ sơ của chính mình — đồng bộ realtime qua Firebase Firestore.
  // Khi đổi tên trên PC → điện thoại tự cập nhật mà không cần reload.
  const [profileName, setProfileName] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [isEditingName, setIsEditingName] = useState(false)

  // Đọc localStorage trước — hiện ngay khi load, Firebase sẽ ghi đè nếu có data mới hơn
  useEffect(() => {
    if (!address) return
    const saved = localStorage.getItem(`sabi-profile-name-${address.toLowerCase()}`)
    setProfileName(saved ?? '')
  }, [address])

  // Firebase realtime listener — tự cập nhật khi đổi từ thiết bị khác
  // Bỏ check !== profileName để tránh stale closure bỏ qua update
  useUserProfileSync(address, (data) => {
    if (data.profileName) setProfileName(data.profileName)
    if (data.avatarUrl) {
      // Tải avatar URL từ Firebase Storage — dùng URL thay vì base64 để nhẹ hơn
      setAvatarUrl(data.avatarUrl)
    }
  })

  const saveProfileNameFn = () => {
    if (!address || !nameDraft.trim()) return
    const name = nameDraft.trim()
    // localStorage (instant) + Firebase Firestore (sync đến mọi thiết bị)
    firebaseSaveProfileName(address, name)
    setProfileName(name)
    setNameDraft('')
    setIsEditingName(false)
  }

  const startEditName = () => {
    setNameDraft(profileName)
    setIsEditingName(true)
  }

  const cancelEditName = () => {
    setNameDraft('')
    setIsEditingName(false)
  }

  // Avatar — tải từ localStorage trước, Firebase Storage URL sẽ ghi đè qua useUserProfileSync
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarDraftUrl, setAvatarDraftUrl] = useState('')
  const avatarInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!address) return
    const key = address.toLowerCase()
    // Thử avatarUrl từ Firebase Storage trước (đồng bộ giữa thiết bị)
    const storageUrl = localStorage.getItem(`sabi-profile-avatar-url-${key}`)
    if (storageUrl) {
      setAvatarUrl(storageUrl)
    } else {
      // Fallback: base64 cũ trong localStorage
      const base64 = localStorage.getItem(`sabi-profile-avatar-${key}`)
      setAvatarUrl(base64 ?? '')
    }
    setAvatarDraftUrl('')
  }, [address])

  // Bill titles từ Firestore — đồng bộ sau khi có danh sách bill từ on-chain
  const [firestoreBillTitles, setFirestoreBillTitles] = useState<Record<string, string>>({})
  const billIdsToSync = billsCreated.map((b) => b.billId.toString())
  useBillTitlesSync(billIdsToSync, (titles) => {
    setFirestoreBillTitles((prev) => ({ ...prev, ...titles }))
  })

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

  const saveAvatar = async () => {
    if (!address || !avatarDraftUrl) return
    // Hiện preview ngay
    setAvatarUrl(avatarDraftUrl)
    setAvatarDraftUrl('')
    // Upload lên Firebase Storage + lưu URL vào Firestore (background)
    await firebaseSaveAvatar(address, avatarDraftUrl)
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
  const billsProgress = useBillsProgress(visibleCreated)

  return (
    <div style={wrap}>
      <Head>
        <title>{t('profile.page_title')}</title>
      </Head>

      <SabiHeader />

      <main className="sabi-page-main" style={{ padding: '24px 16px 40px' }}>
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
              {t('profile.connect_prompt')}
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
                        alt={t('profile.avatar_alt')}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : profileName ? (
                      <span style={{ fontSize: 22, fontWeight: 700 }}>{profileName.charAt(0).toUpperCase()}</span>
                    ) : (
                      <SabiLogo size={40} />
                    )}
                  </div>
                  {/* Nút camera hiện rõ ra ngoài — trước đây bấm thẳng vào avatar mới
                      mở được chọn ảnh, không ai biết bấm vào đâu */}
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    title={t('profile.change_avatar_title')}
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
                      <span style={{ fontSize: 12, color: colors.textSecondary }}>{t('profile.new_photo_selected')}</span>
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
                        {t('profile.save_photo')}
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
                        {t('profile.cancel')}
                      </button>
                    </div>
                  )}
                  {profileName && !isEditingName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: colors.textPrimary }}>{profileName}</div>
                      <button
                        onClick={startEditName}
                        style={{
                          fontSize: 11.5,
                          fontWeight: 600,
                          color: colors.textSecondary,
                          background: 'none',
                          border: `1px solid ${colors.border}`,
                          borderRadius: 6,
                          padding: '2px 8px',
                          cursor: 'pointer',
                        }}
                      >
                        {t('profile.change_name')}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        value={nameDraft}
                        onChange={(e) => setNameDraft(e.target.value)}
                        placeholder={t('profile.name_placeholder')}
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
                        onClick={saveProfileNameFn}
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
                        {t('bill.save')}
                      </button>
                      {profileName && (
                        <button
                          onClick={cancelEditName}
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: colors.textSecondary,
                            background: 'none',
                            border: `1px solid ${colors.border}`,
                            borderRadius: 6,
                            padding: '0 10px',
                            cursor: 'pointer',
                          }}
                        >
                          {t('profile.cancel')}
                        </button>
                      )}
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
                  <Stat label={t('profile.stat_bills_created')} value={billsCreated.length} />
                  <Stat label={t('profile.stat_payments_made')} value={paymentsMade.length} />
                  <Stat label={t('profile.stat_usdc_contributed')} value={formatUnits(totalContributed, 6)} />
                </div>
              </div>

              {isLoading && billsCreated.length === 0 && paymentsMade.length === 0 && (
                <p style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 16 }}>
                  {t('profile.loading_onchain_history')}
                </p>
              )}

              {/* isError riêng biệt với "0 bill thật" — không im lặng hiện empty state khi
                  fetchProfileData lỗi (vd RPC 429 hết retry), tránh hiểu nhầm thành chưa có bill */}
              {isError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 10,
                    flexWrap: 'wrap',
                    background: colors.warningBg,
                    color: colors.warning,
                    borderRadius: radius.card,
                    padding: '10px 14px',
                    fontSize: 13,
                    textAlign: 'center',
                    marginBottom: 16,
                  }}
                >
                  <span>{t('profile.load_error')}</span>
                  <button
                    onClick={() => refetch()}
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: colors.warning,
                      background: 'none',
                      border: `1px solid ${colors.warning}`,
                      borderRadius: 6,
                      padding: '4px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    {t('profile.retry')}
                  </button>
                </div>
              )}

              <div className="sabi-grid-profile">
                <Section title={t('profile.section_created_title')} sub={t('profile.section_created_sub')}>
                  {!isLoading && !isError && billsCreated.length === 0 && <EmptyRow text={t('profile.empty_created')} />}
                  {visibleCreated.map((bill) => (
                    <CreatedBillRow key={bill.txHash} bill={bill} progress={billsProgress[bill.billId.toString()]} titleMap={firestoreBillTitles} />
                  ))}
                  {totalCreatedPages > 1 && (
                    <Pagination page={currentCreatedPage} totalPages={totalCreatedPages} onChange={setCreatedPage} />
                  )}
                </Section>

                <Section title={t('profile.section_paid_title')} sub={t('profile.section_paid_sub')}>
                  {!isLoading && !isError && paymentsMade.length === 0 && <EmptyRow text={t('profile.empty_paid')} />}
                  {visiblePaid.map((p, i) => (
                    <PaymentRow key={`${p.txHash}-${i}`} payment={p} titleMap={firestoreBillTitles} />
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
  const { t } = useTranslation('common')
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
        {t('bill.prev_page')}
      </button>
      <span style={{ fontSize: 12, color: colors.textSecondary }}>
        {t('bill.page_indicator', { current: page + 1, total: totalPages })}
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
        {t('bill.next_page')}
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

function CreatedBillRow({ bill, progress, titleMap }: { bill: CreatedBill; progress: BillProgress | undefined; titleMap: Record<string, string> }) {
  const router = useRouter()
  const { t } = useTranslation('common')
  // Route billId số đã khoá — chỉ shareCode mới link được. Không nên xảy ra
  // sau khi chạy scripts/backfill-sharecodes.mjs, nhưng nếu vì lý do nào đó
  // field bị thiếu, hiện card KHÔNG click được thay vì build ra "/bill/undefined".
  const href = bill.shareCode ? `/bill/${bill.shareCode}` : undefined

  // Prefetch ngay khi danh sách render — bấm vào nhảy liền, không chờ Next.js
  // compile route lần đầu (dev mode compile route theo yêu cầu, gây cảm giác "hơi lâu")
  useEffect(() => {
    if (!href) return
    router.prefetch(href)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href])

  const isDone = progress !== undefined && progress.totalCount > 0 && progress.paidCount >= progress.totalCount

  const content = (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{getBillTitleFromMap(bill.billId, titleMap)}</span>
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
            {isDone ? t('profile.badge_done') : t('profile.badge_collecting')}
          </span>
        )}
      </div>
      <div style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>
        {progress ? `${progress.paidCount}/${progress.totalCount} ${t('profile.paid_suffix')} · ` : ''}
        {formatUnits(bill.totalAmount, 6)} USDC
      </div>
    </>
  )

  const cardStyle: React.CSSProperties = {
    display: 'block',
    padding: '12px 14px',
    background: colors.surface,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    textDecoration: 'none',
  }

  if (!href) {
    return (
      <div className="bill-card" style={{ ...cardStyle, opacity: 0.6 }}>
        {content}
      </div>
    )
  }

  return (
    <Link href={href} className="bill-card" style={cardStyle}>
      {content}
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

function PaymentRow({ payment, titleMap }: { payment: PaymentMade; titleMap: Record<string, string> }) {
  const router = useRouter()
  const { t } = useTranslation('common')
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  // Route billId số đã khoá — chỉ shareCode mới link được, xem CreatedBillRow.
  const href = payment.shareCode ? `/bill/${payment.shareCode}` : undefined

  // Prefetch ngay khi danh sách render — lý do giống CreatedBillRow ở trên
  useEffect(() => {
    if (!href) return
    router.prefetch(href)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [href])

  // "Trả ở đâu" — chỉ xác định được TRỰC TIẾP hay CROSS-CHAIN bằng cách so
  // function selector của tx đã emit event (payShare/paySlot vs payCrossChain).
  // KHÔNG hiện tên chain nguồn cụ thể (Base/Arbitrum/Ethereum Sepolia) vì dữ liệu
  // đó không còn tồn tại lại được ở phía Arc sau khi relay xong — tránh bịa.
  // staleTime: Infinity vì tx đã final on-chain, không bao giờ đổi — tránh gọi
  // lại getTransaction mỗi lần vào /profile (trước đây dùng useEffect + state
  // cục bộ nên refetch mỗi lần mount, dù cùng txHash).
  const { data: method } = useQuery({
    queryKey: ['paymentMethod', payment.txHash],
    queryFn: async () => {
      // withRetry429: retry app-level cho blip mạng/429 thoáng qua — rate-limit
      // request thật ra RPC giờ nằm trong pages/api/rpc-arc.ts (server-side),
      // áp dụng tự động cho MỌI lệnh RPC Arc kể cả lệnh này, không cần tự bọc
      // thêm rate-limit riêng ở đây nữa.
      const tx = await withRetry429(() => publicClient!.getTransaction({ hash: payment.txHash }))
      return tx.input.toLowerCase().startsWith(PAY_CROSSCHAIN_SELECTOR) ? 'crosschain' : 'direct'
    },
    enabled: !!publicClient,
    staleTime: Infinity,
  })

  const description = method === 'crosschain' ? t('profile.payment_method_crosschain') : method === 'direct' ? t('profile.payment_method_direct') : null

  return (
    <div
      className="bill-card"
      onClick={href ? () => router.push(href) : undefined}
      style={{
        padding: '12px 14px',
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 10,
        cursor: href ? 'pointer' : 'default',
        opacity: href ? 1 : 0.6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600 }}>{getBillTitleFromMap(payment.billId, titleMap)}</span>
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
