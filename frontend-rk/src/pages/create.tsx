import { ConnectButton } from '@rainbow-me/rainbowkit'
import type { NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, parseEventLogs } from 'viem'
import { SABI_BILL_ADDRESS, SABI_BILL_ABI } from '../lib/contracts'
import { colors } from '../styles/theme'

type BillMode = 'ASSIGNED' | 'OPEN_SLOT'

interface ShareRow {
  name: string
  amount: string
}

const Create: NextPage = () => {
  const router = useRouter()
  const { isConnected } = useAccount()
  const [step, setStep] = useState<'select' | 'form' | 'confirm'>('select')
  const [mode, setMode] = useState<BillMode>('ASSIGNED')
  const [billName, setBillName] = useState('')
  const [billId, setBillId] = useState<bigint | null>(null)

  const [shares, setShares] = useState<ShareRow[]>([
    { name: '', amount: '' },
    { name: '', amount: '' },
  ])
  const [amountPerSlot, setAmountPerSlot] = useState('')
  const [numSlots, setNumSlots] = useState('')

  const { writeContract, data: txHash, isPending } = useWriteContract()
  const { data: receipt, isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  // Sau khi tx confirm, đọc billId thật từ event BillCreated trong log
  // (billId không có sẵn trong response tx — phải giải mã log mới lấy được)
  useEffect(() => {
    if (!isSuccess || !receipt) return
    try {
      const logs = parseEventLogs({
        abi: SABI_BILL_ABI,
        logs: receipt.logs,
        eventName: 'BillCreated',
      })
      if (logs.length > 0) {
        const newBillId = logs[0].args.billId as bigint
        setBillId(newBillId)

        // Lưu tên các share vào localStorage — contract không lưu tên,
        // trang /bill/[id] cần đọc lại từ đây để hiện đúng tên thay vì "Share #n"
        if (mode === 'ASSIGNED') {
          const namesMap: Record<number, string> = {}
          shares
            .filter((s) => s.amount) // chỉ lưu share thật sự được tạo (có amount)
            .forEach((s, i) => {
              if (s.name.trim()) namesMap[i] = s.name.trim()
            })
          if (Object.keys(namesMap).length > 0) {
            localStorage.setItem(`sabi-bill-${newBillId.toString()}-names`, JSON.stringify(namesMap))
          }
        }
        // Điều hướng thẳng sang trang chi tiết bill — không dừng ở màn hình link/copy nào cả
        router.push(`/bill/${newBillId}`)
      } else {
        console.error('Không tìm thấy event BillCreated trong log')
      }
    } catch (err) {
      console.error('Lỗi đọc billId từ log:', err)
    }
  }, [isSuccess, receipt])

  const totalAssigned = shares.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const totalOpen = (parseFloat(amountPerSlot) || 0) * (parseInt(numSlots) || 0)

  const addShare = () => setShares([...shares, { name: '', amount: '' }])
  const updateShare = (i: number, field: keyof ShareRow, val: string) => {
    const next = [...shares]
    next[i][field] = val
    setShares(next)
  }
  const removeShare = (i: number) => setShares(shares.filter((_, idx) => idx !== i))

  const handleCreate = async () => {
    if (!isConnected) return
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
        })
      } else {
        writeContract({
          address: SABI_BILL_ADDRESS,
          abi: SABI_BILL_ABI,
          functionName: 'createOpenSlotBill',
          args: [
            parseUnits(amountPerSlot, 6),
            BigInt(parseInt(numSlots)),
          ],
        })
      }
    } catch (e) {
      console.error(e)
    }
  }

  // ── Step 1: Chọn mode ────────────────────────────────────────────────────
  if (step === 'select') return (
    <div style={wrap}>
      <Head><title>Create bill — Sabi</title></Head>
      <nav style={nav}>
        <span style={logo} onClick={() => router.push('/')}>Sabi</span>
        <ConnectButton />
      </nav>
      <div style={center}>
        <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: colors.textPrimary }}>Create a bill</h2>
        <p style={{ color: colors.textSecondary, marginBottom: 32 }}>Choose how to split</p>
        <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
        {([
          { m: 'ASSIGNED', title: 'Assigned', desc: 'Assign each person a specific amount', icon: '👤' },
          { m: 'OPEN_SLOT', title: 'Open Slot', desc: 'Anyone can pay — no name required', icon: '🔓' },
        ] as const).map(({ m, title, desc, icon }) => (
          <div
            key={m}
            onClick={() => { setMode(m); setStep('form') }}
            style={{
              border: `2px solid ${mode === m ? colors.primary : colors.border}`,
              borderRadius: 16,
              padding: '40px 48px',
              cursor: 'pointer',
              width: 280,
              minHeight: 200,
              textAlign: 'center',
              background: mode === m ? colors.selectedBg : colors.surface,
              boxShadow: mode === m ? `0 4px 24px ${colors.primary}20` : `0 2px 8px ${colors.shadowColor}`,
              transition: 'all 0.15s',
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>{icon}</div>
            <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 10, color: colors.textPrimary }}>{title}</div>
            <div style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.5 }}>{desc}</div>
            <p style={{ marginTop: 32, fontSize: 13, color: colors.textMuted }}>
              Bills are stored on-chain · Arc Testnet · USDC
            </p>
          </div>
        ))}
      </div>
      </div>
    </div>
  )

  // ── Step 2: Form ─────────────────────────────────────────────────────────
  if (step === 'form') return (
    <div style={wrap}>
      <Head><title>Create bill — Sabi</title></Head>
      <nav style={nav}>
        <span style={logo} onClick={() => router.push('/')}>Sabi</span>
        <ConnectButton />
      </nav>
      <div style={{ maxWidth: 560, margin: '48px auto', padding: '0 24px' }}>
        <button onClick={() => setStep('select')} style={backBtn}>← Back</button>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: colors.textPrimary }}>
          {mode === 'ASSIGNED' ? 'Assigned bill' : 'Open slot bill'}
        </h2>

        <label style={lbl}>Bill name (optional)</label>
        <input style={input} placeholder="e.g. Dinner at ABC" value={billName} onChange={e => setBillName(e.target.value)} />

        {mode === 'ASSIGNED' ? (
          <>
            <label style={lbl}>People & amounts</label>
            {shares.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input style={{ ...input, flex: 2, marginBottom: 0 }} placeholder="Name (optional)" value={s.name} onChange={e => updateShare(i, 'name', e.target.value)} />
                <input style={{ ...input, flex: 1, marginBottom: 0 }} placeholder="USDC" type="number" min="0" value={s.amount} onChange={e => updateShare(i, 'amount', e.target.value)} />
                {shares.length > 1 && <button onClick={() => removeShare(i)} style={rmBtn}>✕</button>}
              </div>
            ))}
            <button onClick={addShare} style={ghostBtn}>+ Add person</button>
            <div style={{ marginTop: 16, color: colors.textSecondary, fontSize: 14 }}>
              Total: <strong style={{ color: colors.textPrimary }}>{totalAssigned.toFixed(2)} USDC</strong>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Amount per person (USDC)</label>
                <input style={input} placeholder="e.g. 1" type="number" min="0" value={amountPerSlot} onChange={e => setAmountPerSlot(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={lbl}>Number of people</label>
                <input style={input} placeholder="e.g. 4" type="number" min="1" value={numSlots} onChange={e => setNumSlots(e.target.value)} />
              </div>
            </div>
            {totalOpen > 0 && (
              <div style={{ color: colors.textSecondary, fontSize: 14 }}>
                Total: <strong style={{ color: colors.textPrimary }}>{totalOpen.toFixed(2)} USDC</strong>
              </div>
            )}
          </>
        )}

        <button
          onClick={() => setStep('confirm')}
          style={{ ...primaryBtn, marginTop: 32, width: '100%' }}
          disabled={mode === 'ASSIGNED' ? shares.every(s => !s.amount) : !amountPerSlot || !numSlots}
        >
          Preview →
        </button>
      </div>
    </div>
  )

  // ── Step 3: Confirm ────────────────────────────────────────────────────────
  return (
    <div style={wrap}>
      <Head><title>Confirm — Sabi</title></Head>
      <nav style={nav}>
        <span style={logo} onClick={() => router.push('/')}>Sabi</span>
        <ConnectButton />
      </nav>

      <div style={{ maxWidth: 480, margin: '48px auto', padding: '0 24px' }}>
        <button onClick={() => setStep('form')} style={backBtn}>← Edit</button>
        <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24, color: colors.textPrimary }}>Confirm bill</h2>

        <div style={card}>
          <div style={rowStyle}><span style={lbl2}>Mode</span><span>{mode === 'ASSIGNED' ? 'Assigned' : 'Open Slot'}</span></div>
          {billName && <div style={rowStyle}><span style={lbl2}>Name</span><span>{billName}</span></div>}
          {mode === 'ASSIGNED' ? (
            <>
              <div style={rowStyle}><span style={lbl2}>Total</span><strong>{totalAssigned.toFixed(2)} USDC</strong></div>
              <div style={{ marginTop: 12 }}>
                {shares.filter(s => s.amount).map((s, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: `1px solid ${colors.borderLight}`, fontSize: 14 }}>
                    <span style={{ color: colors.textSecondary }}>{s.name || `Share #${i + 1}`}</span>
                    <span>{parseFloat(s.amount).toFixed(2)} USDC</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div style={rowStyle}><span style={lbl2}>Per person</span><span>{amountPerSlot} USDC</span></div>
              <div style={rowStyle}><span style={lbl2}>Slots</span><span>{numSlots}</span></div>
              <div style={rowStyle}><span style={lbl2}>Total</span><strong>{totalOpen.toFixed(2)} USDC</strong></div>
            </>
          )}
        </div>

        <p style={{ fontSize: 13, color: colors.warning, marginTop: 12 }}>⚠ Cannot be edited after creation.</p>

        {!isConnected && (
          <div style={{ marginTop: 16 }}>
            <p style={{ color: colors.danger, fontSize: 13, marginBottom: 8 }}>Connect wallet to create bill</p>
            <ConnectButton />
          </div>
        )}

        {isConnected && (
          <button
            onClick={handleCreate}
            style={{ ...primaryBtn, marginTop: 20, width: '100%' }}
            disabled={isPending || isConfirming}
          >
            {isPending
              ? 'Confirm in wallet...'
              : isConfirming
              ? 'Creating bill...'
              : isSuccess
              ? 'Redirecting...'
              : 'Create bill'}
          </button>
        )}
      </div>
    </div>
  )
}

const wrap: React.CSSProperties = { minHeight: '100vh', fontFamily: 'sans-serif', background: colors.background }
const nav: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 40px', borderBottom: `1px solid ${colors.borderLight}`, background: colors.surface }
const logo: React.CSSProperties = { fontSize: 20, fontWeight: 800, color: colors.primary, cursor: 'pointer' }
const center: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 'calc(100vh - 57px)' }
const input: React.CSSProperties = { width: '100%', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '10px 14px', fontSize: 14, marginBottom: 12, boxSizing: 'border-box', outline: 'none' }
const lbl: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: colors.label, display: 'block', marginBottom: 6 }
const lbl2: React.CSSProperties = { fontSize: 13, color: colors.textSecondary }
const primaryBtn: React.CSSProperties = { background: colors.primary, color: 'white', border: 'none', borderRadius: 10, padding: '13px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }
const ghostBtn: React.CSSProperties = { background: colors.surface, color: colors.primary, border: `1px solid ${colors.primary}`, borderRadius: 8, padding: '10px 16px', fontSize: 13, cursor: 'pointer' }
const backBtn: React.CSSProperties = { background: 'none', border: 'none', color: colors.textSecondary, fontSize: 14, cursor: 'pointer', padding: 0, marginBottom: 16 }
const rmBtn: React.CSSProperties = { background: 'none', border: `1px solid ${colors.border}`, borderRadius: 6, width: 32, height: 38, cursor: 'pointer', color: colors.textMuted, flexShrink: 0 }
const card: React.CSSProperties = { background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 12, padding: '20px 24px' }
const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `1px solid ${colors.backgroundSubtle}`, fontSize: 14 }

export default Create