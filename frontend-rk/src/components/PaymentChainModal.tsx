import { useEffect, useState } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { useTranslation } from 'next-i18next'
import { formatUnits } from 'viem'
import { Modal } from './Modal'
import { colors } from '../styles/theme'
import { SourceChain } from '../hooks/useBurnCrossChain'
import {
  baseSepolia,
  arbitrumSepolia,
  BASE_SEPOLIA_USDC_ADDRESS,
  ARBITRUM_SEPOLIA_USDC_ADDRESS,
  ETHEREUM_SEPOLIA_USDC_ADDRESS,
  ERC20_ABI,
} from '../lib/contracts'

// Cấu hình 3 chain nguồn cho modal chọn chain — dot màu theo brand color
// riêng từng chain (không phải màu theme app), tách khỏi BALANCE_CHECK_CONFIG
// trong useCrossChainPayment.ts vì đó là logic contract, đây chỉ là UI.
const CHAIN_OPTIONS: { key: SourceChain; name: string; dotColor: string; chainId: number; usdcAddress: `0x${string}` }[] = [
  { key: 'base', name: 'Base Sepolia', dotColor: '#2775CA', chainId: baseSepolia.id, usdcAddress: BASE_SEPOLIA_USDC_ADDRESS },
  { key: 'arbitrum', name: 'Arbitrum Sepolia', dotColor: '#28A0F0', chainId: arbitrumSepolia.id, usdcAddress: ARBITRUM_SEPOLIA_USDC_ADDRESS },
  { key: 'ethereum', name: 'Ethereum Sepolia', dotColor: '#8A94AC', chainId: sepolia.id, usdcAddress: ETHEREUM_SEPOLIA_USDC_ADDRESS },
]

const fmt2 = (n: bigint) => Number(formatUnits(n, 6)).toFixed(2)

export function PaymentChainModal({
  amount,
  payerName,
  onCancel,
  onConfirm,
}: {
  amount: bigint
  payerName: string
  onCancel: () => void
  onConfirm: (chain: SourceChain) => void
}) {
  const { t } = useTranslation('common')
  const { address, chainId: currentChainId } = useAccount()
  const publicClientBase = usePublicClient({ chainId: baseSepolia.id })
  const publicClientArbitrum = usePublicClient({ chainId: arbitrumSepolia.id })
  const publicClientEthereum = usePublicClient({ chainId: sepolia.id })
  const publicClients = { base: publicClientBase, arbitrum: publicClientArbitrum, ethereum: publicClientEthereum }

  // undefined = đang load, bigint = đã đọc xong — mỗi chain tự cập nhật độc lập
  // để card nào đọc xong hiện trước, không phải đợi chain chậm nhất
  const [balances, setBalances] = useState<Partial<Record<SourceChain, bigint>>>({})
  const [selected, setSelected] = useState<SourceChain | null>(null)

  useEffect(() => {
    if (!address) return
    setBalances({})
    CHAIN_OPTIONS.forEach(async (opt) => {
      const client = publicClients[opt.key]
      if (!client) return
      try {
        const balance = (await client.readContract({
          address: opt.usdcAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint
        setBalances((prev) => ({ ...prev, [opt.key]: balance }))
      } catch {
        setBalances((prev) => ({ ...prev, [opt.key]: 0n }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  // Chỉ chain ví ĐANG connect mới được ký — 2 chain còn lại luôn xám, bất kể
  // balance, để tránh phải tự switch mạng ngầm giữa lúc ký (rủi ro UX/bảo mật
  // hơn là để user tự đổi mạng trong ví rồi modal tự nhận lại theo currentChainId).
  const activeOption = CHAIN_OPTIONS.find((o) => o.chainId === currentChainId)

  useEffect(() => {
    if (activeOption && (balances[activeOption.key] ?? 0n) >= amount) {
      setSelected(activeOption.key)
    } else {
      setSelected(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChainId, JSON.stringify(Object.entries(balances)), amount])

  const canConfirm = selected !== null

  return (
    <Modal onClose={onCancel} maxWidth={540} cardRadius={22}>
      <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: colors.textPrimary }}>
        {t('paymentModal.chain.title', { amount: fmt2(amount), name: payerName })}
      </p>
      <p style={{ margin: '0 0 18px', fontSize: 13, color: colors.textSecondary }}>
        {t('paymentModal.chain.subtitle')}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 22 }}>
        {CHAIN_OPTIONS.map((opt) => {
          const balance = balances[opt.key]
          const isLoading = balance === undefined
          const isActive = opt.chainId === currentChainId
          const isSelected = selected === opt.key
          const disabled = isLoading || !isActive || (balance !== undefined && balance < amount)
          return (
            <button
              key={opt.key}
              onClick={() => !disabled && setSelected(opt.key)}
              disabled={disabled}
              style={{
                border: `1.5px solid ${isSelected ? colors.primary : colors.border}`,
                borderRadius: 14,
                background: isSelected ? colors.selectedBg : colors.surface,
                padding: '12px 10px',
                cursor: disabled ? 'default' : 'pointer',
                opacity: disabled ? 0.35 : 1,
                pointerEvents: disabled ? 'none' : 'auto',
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: isSelected ? colors.primary : colors.textPrimary }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: opt.dotColor, flexShrink: 0 }} />
                {opt.name}
              </span>
              <span style={{ fontSize: 10.5, color: colors.textSecondary, marginTop: 5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', display: 'block' }}>
                {isLoading
                  ? t('paymentModal.chain.balance_loading')
                  : t('paymentModal.chain.balance_label', { amount: fmt2(balance) })}
              </span>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
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
          {t('paymentModal.chain.cancel')}
        </button>
        <button
          onClick={() => selected && onConfirm(selected)}
          disabled={!canConfirm}
          style={{
            padding: '10px 22px',
            borderRadius: 50,
            fontSize: 13.5,
            fontWeight: 600,
            cursor: canConfirm ? 'pointer' : 'not-allowed',
            background: canConfirm ? colors.buttonPrimary : colors.textMuted,
            color: '#fff',
            border: 'none',
          }}
        >
          {t('paymentModal.chain.sign_button')}
        </button>
      </div>
    </Modal>
  )
}
