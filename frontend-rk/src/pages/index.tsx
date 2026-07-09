import { arcTestnet } from '../wagmi'
import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useSwitchChain } from 'wagmi'
import { parseUnits, parseEventLogs } from 'viem'
import { baseSepolia, arbitrumSepolia } from 'wagmi/chains'
import { sepolia } from 'wagmi/chains'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI } from '../lib/contracts'
import { colors } from '../styles/theme'
import { ModeCard } from '../components/ModeCard'
import { saveBillTitle, saveBillShareNames } from '../hooks/useFirebaseSync'

import { SabiHeader } from '../components/SabiHeader'
import { SabiLogo } from '../components/SabiLogo'

type BillMode = 'ASSIGNED' | 'OPEN_SLOT'

// Tự động viết hoa chữ cái đầu tiên khi gõ tên bill / tên người
const capitalizeFirst = (s: string) => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1))

interface ShareRow {
  name: string
  amount: string
}

// Trang tạo bill — 1 màn hình duy nhất: mode-card + form + nút tạo, không có
// bước "xem trước" riêng nữa. Tạo xong điều hướng sang Hồ sơ để thấy bill
// vừa tạo xuất hiện ngay trong danh sách "Bill đã tạo".
const Home: NextPage = () => {
  const router = useRouter()
  const { isConnected } = useAccount()
  const [mode, setMode] = useState<BillMode>('ASSIGNED')
  const [billName, setBillName] = useState('')
  const { chainId: currentChainId } = useAccount()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const [switchError, setSwitchError] = useState<string | null>(null)

  // Chỉ báo "mạng sai" nếu KHÔNG thuộc 4 chain được hỗ trợ.
  // Arc, Base Sepolia, Arb Sepolia, Eth Sepolia đều được chấp nhận —
  // nút tạo bill sẽ tự switch sang Arc nếu đang ở chain khác trong 4 chain này.
  const SUPPORTED_CHAIN_IDS: number[] = [arcTestnet.id, baseSepolia.id, arbitrumSepolia.id, sepolia.id]
  const isOnArc = currentChainId === arcTestnet.id
  const isWrongNetwork = currentChainId !== undefined && !SUPPORTED_CHAIN_IDS.includes(currentChainId as number)
  // Đang ở chain hợp lệ nhưng không phải Arc → cần switch trước khi tạo bill
  const needsSwitchToArc = currentChainId !== undefined && !isOnArc && !isWrongNetwork

  const [shares, setShares] = useState<ShareRow[]>([
    { name: '', amount: '' },
    { name: '', amount: '' },
    { name: '', amount: '' },
    { name: '', amount: '' },
  ])
  const [totalOpenInput, setTotalOpenInput] = useState('')
  const [numSlots, setNumSlots] = useState('')
  const numSlotsInt = parseInt(numSlots) || 0
  const totalOpenValue = parseFloat(totalOpenInput) || 0
  // Mỗi người góp = tổng ÷ N, tính ra chứ không cho nhập trực tiếp — khớp
  // sabi-ui-prototype-v8.html (osTotal/osSlots → osPer tự tính)
  const amountPerSlotComputed = numSlotsInt > 0 ? totalOpenValue / numSlotsInt : 0

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Sau khi tx confirm, đọc billId thật từ event BillCreated trong log
  // (billId không có sẵn trong response tx — phải giải mã log mới lấy được)
  useEffect(() => {
    if (!isSuccess || !receipt) return
    ;(async () => {
      try {
        const logs = parseEventLogs({
          abi: SABI_BILL_ABI,
          logs: receipt.logs,
          eventName: 'BillCreated',
        })
        if (logs.length > 0) {
          const newBillId = logs[0].args.billId as bigint
          const billIdStr = newBillId.toString()

          // Lưu tên các share vào localStorage + Firebase Firestore —
          // Firestore cho phép thiết bị khác đọc được tên ngay sau khi tạo.
          if (mode === 'ASSIGNED') {
            const namesMap: Record<number, string> = {}
            shares
              .filter((s) => s.amount)
              .forEach((s, i) => {
                if (s.name.trim()) namesMap[i] = s.name.trim()
              })
            if (Object.keys(namesMap).length > 0) {
              // localStorage (local, instant)
              localStorage.setItem(`sabi-bill-${billIdStr}-names`, JSON.stringify(namesMap))
              // Firebase Firestore (sync across devices)
              saveBillShareNames(billIdStr, namesMap)
            }
          }

          // Lưu tên bill vào localStorage + Firebase Firestore
          if (billName.trim()) {
            localStorage.setItem(`sabi-bill-${billIdStr}-title`, billName.trim())
            saveBillTitle(billIdStr, billName.trim())
          }

          // Micro-delay để đảm bảo localStorage flush trước khi navigate
          // (mobile Safari/Chrome đôi khi chưa persist khi navigate ngay)
          await new Promise((r) => setTimeout(r, 80))

          // Sang trang chi tiết bill — thay vì /profile để user thấy ngay hóa đơn
          router.push(`/bill/${billIdStr}`)
        } else {
          console.error('Không tìm thấy event BillCreated trong log')
          // Vẫn navigate về profile để user không bị kẹt màn hình
          router.push('/profile')
        }
      } catch (err) {
        console.error('Lỗi đọc billId từ log:', err)
        // Vẫn navigate để không bị kẹt
        router.push('/profile')
      }
    })()
  }, [isSuccess, receipt])

  const totalAssigned = shares.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const totalOpen = totalOpenValue

  const addShare = () => setShares([...shares, { name: '', amount: '' }])
  const updateShare = (i: number, field: keyof ShareRow, val: string) => {
    const next = [...shares]
    next[i][field] = val
    setShares(next)
  }
  const removeShare = (i: number) => setShares(shares.filter((_, idx) => idx !== i))

  const handleSwitchToArc = async () => {
    setSwitchError(null)
    try {
      await switchChainAsync({ chainId: arcTestnet.id })
    } catch (err: any) {
      // User từ chối hoặc ví không phản hồi — hiện thông báo hướng dẫn
      if (!err?.message?.includes('rejected')) {
        setSwitchError('Mở app ví và xác nhận đổi sang Arc Testnet')
        setTimeout(() => setSwitchError(null), 5000)
      }
    }
  }

  const handleCreate = async () => {
    if (!isConnected) return
    setSwitchError(null)
    // Nếu đang ở chain hợp lệ nhưng không phải Arc → switch trước rồi tạo
    if (needsSwitchToArc) {
      try {
        await switchChainAsync({ chainId: arcTestnet.id })
      } catch {
        setSwitchError('Mở app ví và xác nhận đổi sang Arc Testnet')
        setTimeout(() => setSwitchError(null), 5000)
        return
      }
    }
    try {
      if (mode === 'ASSIGNED') {
        const amounts = shares
          .filter(s => s.amount)
          .map(s => parseUnits(s.amount, 6))

        writeContract({
          address: SABI_BILL_ADDRESS,
          abi: SABI_BILL_ABI,
          functionName: 'createAssignedBill',
          args: [amounts],
          chainId: arcTestnet.id,
        })
      } else {
        writeContract({
          address: SABI_BILL_ADDRESS,
          abi: SABI_BILL_ABI,
          functionName: 'createOpenSlotBill',
          args: [
            parseUnits(amountPerSlotComputed.toFixed(6), 6),
            BigInt(numSlotsInt),
          ],
          chainId: arcTestnet.id,
        })
      }
    } catch (e) {
      console.error(e)
    }
  }

  const formIncomplete = mode === 'ASSIGNED' ? shares.every(s => !s.amount) : !totalOpenInput || !numSlots

  return (
    <div style={wrap}>
      <Head><title>Tạo bill — Sabi</title></Head>
      <SabiHeader />
      <div
        className="sabi-grid-create"
        style={{
          maxWidth: 1080,
          margin: '32px auto',
          padding: '0 16px',
        }}
      >
        <div>
          <div className="sabi-mode-cards">
            <ModeCard
              mode="assigned"
              tag="ASSIGNED"
              title="Chia theo danh sách"
              description="Đặt tên và số tiền cho từng phần. Ai cũng trả được phần bất kỳ, trạng thái tick theo từng tên."
              selected={mode === 'ASSIGNED'}
              onClick={() => setMode('ASSIGNED')}
            />
            <ModeCard
              mode="openslot"
              tag="OPEN-SLOT"
              title="Chia đều"
              description="Tổng tiền chia đều cho số người"
              selected={mode === 'OPEN_SLOT'}
              onClick={() => setMode('OPEN_SLOT')}
            />
          </div>

          <label style={lbl}>Tên bill</label>
          <input style={input} placeholder="Lẩu tối thứ 6" value={billName} onChange={e => setBillName(capitalizeFirst(e.target.value))} />

          {mode === 'ASSIGNED' ? (
            <>
              <label style={lbl}>Người tham gia & số tiền</label>
              {shares.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <input style={{ ...input, flex: 1, marginBottom: 0 }} placeholder="Tên" value={s.name} onChange={e => updateShare(i, 'name', capitalizeFirst(e.target.value))} />
                  <input style={{ ...amountInput, flex: 1, marginBottom: 0 }} placeholder="0.00" type="number" min="0" value={s.amount} onChange={e => updateShare(i, 'amount', e.target.value)} />
                  {shares.length > 1 && <button onClick={() => removeShare(i)} style={rmBtn}>✕</button>}
                </div>
              ))}
              <button onClick={addShare} style={addRowBtn}>+ Thêm người</button>
              <TotalLine label="Tổng bill (tự cộng)" value={`${totalAssigned.toFixed(2)} USDC`} />
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Tổng tiền (USDC)</label>
                  <input style={amountInput} placeholder="VD: 40" type="number" min="0" value={totalOpenInput} onChange={e => setTotalOpenInput(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Số người</label>
                  <input style={amountInput} placeholder="VD: 4" type="number" min="1" value={numSlots} onChange={e => setNumSlots(e.target.value)} />
                </div>
              </div>
              {numSlotsInt > 0 && <TotalLine label="Mỗi người góp (tổng ÷ N)" value={`${amountPerSlotComputed.toFixed(2)} USDC`} />}
            </>
          )}

          {/* Nút đổi mạng riêng — chỉ hiện khi ở sai mạng hoàn toàn (ngoài 4 chain) */}
          {isWrongNetwork && (
            <button
              onClick={handleSwitchToArc}
              disabled={isSwitching}
              style={{ ...primaryBtn, marginTop: 16, width: '100%', background: isSwitching ? colors.textMuted : '#e07c00' }}
            >
              {isSwitching ? 'Đang đổi mạng...' : '⚡ Bấm đây để đổi sang Arc Testnet'}
            </button>
          )}

          {/* Nút tạo bill — ẩn khi sai mạng hoàn toàn */}
          {!isWrongNetwork && (
            <button
              onClick={needsSwitchToArc ? handleCreate : handleCreate}
              style={{ ...primaryBtn, marginTop: 16, width: '100%' }}
              disabled={!isConnected || isPending || isConfirming || isSwitching || formIncomplete}
            >
              {!isConnected
                ? 'Kết nối ví để tạo bill'
                : isSwitching
                ? 'Đang đổi sang Arc...'
                : needsSwitchToArc
                ? '⚡ Chuyển sang Arc & tạo bill'
                : isPending
                ? 'Đang xác nhận trong ví...'
                : isConfirming
                ? 'Đang tạo bill...'
                : isSuccess
                ? 'Đang chuyển trang...'
                : 'Tạo bill'}
            </button>
          )}

          {switchError && (
            <p style={{ fontSize: 12, color: '#e07c00', fontFamily: 'sans-serif', marginTop: 8, textAlign: 'center' }}>
              📱 {switchError}
            </p>
          )}
          <p style={{ fontSize: 12, color: colors.textPrimary, fontFamily: 'sans-serif', marginTop: 10, textAlign: 'center' }}>
            <span style={{ color: colors.primary }}>⚠</span> Không thể chỉnh sửa sau khi tạo.
          </p>
        </div>

        <div className="sabi-receipt-preview-hide-mobile">
          <ReceiptPreview
            billName={billName}
            mode={mode}
            shares={shares}
            amountPerSlot={amountPerSlotComputed}
            numSlots={numSlots}
            total={mode === 'ASSIGNED' ? totalAssigned : totalOpen}
          />
        </div>
      </div>
    </div>
  )
}

// Xem trước bill dạng "hoá đơn" — bên phải trang tạo bill, khớp bố cục sabi-ui-prototype-v8.html
// (màu paper-ink/paper-mut riêng cho receipt + viền răng cưa trên dưới kiểu giấy in hoá đơn).
// Bill CHƯA tồn tại on-chain lúc này nên chưa có billId/URL thật — QR chỉ là placeholder,
// không tạo QR giả trỏ tới URL không có thật. QR/link thật chỉ xuất hiện ở trang /bill/[id]
// sau khi tạo xong.
function ReceiptPreview({
  billName,
  mode,
  shares,
  amountPerSlot,
  numSlots,
  total,
}: {
  billName: string
  mode: BillMode
  shares: ShareRow[]
  amountPerSlot: number
  numSlots: string
  total: number
}) {
  const rows =
    mode === 'ASSIGNED'
      ? shares.map((s) => ({ name: s.name.trim() || '—', amount: parseFloat(s.amount) || 0 }))
      : [{ name: `Mỗi slot (0/${numSlots || '—'})`, amount: amountPerSlot }]

  return (
    <div className="receipt">
      <div style={{ textAlign: 'center', paddingBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>
          <SabiLogo size={38} />
        </div>
        <div style={{ fontFamily: 'sans-serif', fontWeight: 800, fontSize: 19, color: colors.paperInk }}>SABI</div>
        <div style={{ fontSize: 10, color: colors.paperMuted, marginTop: 3, letterSpacing: 1 }}>SPLIT BILL · ARC TESTNET</div>
      </div>

      <ReceiptDash />
      <ReceiptRow k="BILL" v={billName || '—'} />
      <ReceiptRow k="MODE" v={mode === 'ASSIGNED' ? 'ASSIGNED' : 'OPEN-SLOT'} />
      <ReceiptDash />

      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '7px 0', gap: 10 }}>
          <span style={{ flex: 1, fontWeight: 500, color: colors.paperInk, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
          <span style={{ fontWeight: 700, color: colors.paperInk }}>{r.amount.toFixed(2)}</span>
        </div>
      ))}

      <ReceiptDash />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '7px 0 2px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: 1, color: colors.paperInk }}>TỔNG</span>
        <span style={{ fontSize: 22, fontWeight: 700, color: colors.paperInk }}>
          {total.toFixed(2)} <small style={{ fontSize: 11, color: colors.paperMuted, fontWeight: 500 }}>USDC</small>
        </span>
      </div>
      <ReceiptDash />

      <style jsx>{`
        .receipt {
          background: ${colors.surface};
          border-radius: 4px;
          padding: 24px 22px 18px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          box-shadow: 0 20px 40px ${colors.shadowColor};
          position: relative;
        }
        /* Viền răng cưa trên/dưới kiểu giấy in hoá đơn — copy đúng kỹ thuật
           repeating radial-gradient từ sabi-ui-prototype-v8.html (.receipt::before/::after) */
        .receipt::before,
        .receipt::after {
          content: '';
          position: absolute;
          left: 0;
          right: 0;
          height: 10px;
          background-size: 16px 10px;
          background-repeat: repeat-x;
        }
        .receipt::before {
          top: -9px;
          background-image: radial-gradient(circle at 8px 10px, transparent 6px, ${colors.surface} 6.5px);
        }
        .receipt::after {
          bottom: -9px;
          background-image: radial-gradient(circle at 8px 0px, transparent 6px, ${colors.surface} 6.5px);
        }
      `}</style>
    </div>
  )
}

// Dòng "Tổng bill" — label mờ bên trái, giá trị monospace lớn đậm bên phải,
// khớp .total-line trong sabi-ui-prototype-v8.html
function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '12px 4px',
        fontSize: 14,
        color: colors.textSecondary,
      }}
    >
      <span>{label}</span>
      <b style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 20, color: colors.textPrimary }}>
        {value}
      </b>
    </div>
  )
}

function ReceiptDash() {
  return <hr style={{ border: 'none', borderTop: `1.5px dashed ${colors.borderLight}`, margin: '9px 0' }} />
}

function ReceiptRow({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, padding: '4px 0', gap: 12 }}>
      <span style={{ color: colors.paperMuted }}>{k}</span>
      <span style={{ fontWeight: 600, color: colors.paperInk, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  )
}

const wrap: React.CSSProperties = { minHeight: '100vh', fontFamily: 'sans-serif', background: colors.background, overflowX: 'hidden', maxWidth: '100vw' }
const input: React.CSSProperties = {
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
}
const amountInput: React.CSSProperties = {
  ...input,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  textAlign: 'right',
}
const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: colors.label, display: 'block', marginBottom: 6 }
const primaryBtn: React.CSSProperties = { background: colors.buttonPrimary, color: 'white', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }
const addRowBtn: React.CSSProperties = {
  width: '100%',
  padding: 11,
  border: `1.5px dashed ${colors.border}`,
  borderRadius: 12,
  background: 'none',
  color: colors.textSecondary,
  fontWeight: 600,
  fontSize: 13.5,
  cursor: 'pointer',
}
const rmBtn: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 6, width: 32, height: 38, cursor: 'pointer', color: colors.textMuted, flexShrink: 0 }

export default Home
