import { useTranslation } from 'next-i18next'
import { CrossChainState } from '../hooks/useCrossChainPayment'
import { colors, radius } from '../styles/theme'

// Tên hiển thị + explorer URL theo từng chain nguồn — thêm chain mới chỉ cần thêm 1 dòng
const SOURCE_CHAIN_DISPLAY = {
  base: { name: 'Base Sepolia', explorerBase: 'https://sepolia.basescan.org/tx/' },
  arbitrum: { name: 'Arbitrum Sepolia', explorerBase: 'https://sepolia.arbiscan.io/tx/' },
  ethereum: { name: 'Ethereum Sepolia', explorerBase: 'https://sepolia.etherscan.io/tx/' },
} as const

function getChainDisplay(sourceChain: CrossChainState['sourceChain'], t: (key: string) => string) {
  return sourceChain ? SOURCE_CHAIN_DISPLAY[sourceChain] : { name: t('crosschain.default_chain_name'), explorerBase: '#' }
}

// Faucet gas ETH testnet riêng từng chain nguồn — balance check ("insufficient_balance")
// chỉ kiểm tra USDC, nhưng user thiếu ETH để trả gas cũng bị kẹt y hệt, nên đưa cả 2 loại faucet
const GAS_FAUCET_URL = {
  base: 'https://www.alchemy.com/faucets/base-sepolia',
  arbitrum: 'https://www.alchemy.com/faucets/arbitrum-sepolia',
  ethereum: 'https://www.alchemy.com/faucets/ethereum-sepolia',
} as const

// D1 — Pending attestation: hiện khi đang chờ Circle ký xác nhận sau khi đã burn xong
// D2 — Error: hiện 1 trong 4 case, mỗi case có message + hành động phù hợp riêng
export function CrossChainStatusPanel({
    state,
    onRetry,
    onDismiss,
    contributorName,
    isDelayed,
  }: {
    state: CrossChainState
    onRetry: () => void
    onDismiss: () => void
    contributorName?: string
    isDelayed?: boolean
  }) {
  const { t } = useTranslation('common')
  const chainDisplay = getChainDisplay(state.sourceChain, t)

  if (state.status === 'checking_balance' || state.status === 'burning') {
    return (
      <Panel>
        <p style={{ color: colors.textSecondary, fontSize: 13 }}>
          {state.status === 'checking_balance' ? t('crosschain.checking_balance') : t('crosschain.burning')}
        </p>
      </Panel>
    )
  }

  // ─── D1 — Pending attestation ───────────────────────────────────────────
  if (state.status === 'waiting_attestation' || state.status === 'relaying') {
    return (
      <Panel>
        <p style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          {t('crosschain.processing')}{contributorName && ` — ${contributorName}`}
        </p>
        <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8 }}>
          {t('crosschain.burn_confirmed', { chain: chainDisplay.name })}
        </p>
        {state.burnTxHash && (

<a
            href={`${chainDisplay.explorerBase}${state.burnTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              marginBottom: 8,
              color: colors.primary,
              fontSize: 12,
              textDecoration: 'underline',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {t('crosschain.view_burn_tx', { hash: `${state.burnTxHash.slice(0, 10)}...${state.burnTxHash.slice(-8)}` })}
          </a>
        )}
        {/* relaying = ví đang bật popup: switch mạng sang Arc + ký payCrossChain.
            Phải nói rõ user cần KÝ, không thì tưởng hệ thống tự chạy rồi bỏ lỡ popup. */}
        {state.status === 'relaying' ? (
          <>
            <p style={{ color: colors.textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              {t('crosschain.relaying_title')}
            </p>
            <p style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
              {t('crosschain.relaying_desc')}
            </p>
          </>
        ) : isDelayed ? (
          <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 4 }}>
            {t('crosschain.delayed_note')}
          </p>
        ) : (
          <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 4 }}>
            {t('crosschain.waiting_attestation')}
          </p>
        )}
        <p style={{ color: colors.textMuted, fontSize: 12 }}>
          {t('crosschain.no_loss_note')}
        </p>
      </Panel>
    )
  }
  // ─── Success: lấp gap giữa "relay xong" và "danh sách hiện dòng mới" ──────
  // Nếu không có panel này, relay xong panel biến mất ngay nhưng danh sách
  // "Người đã góp" còn phải quét event vài giây → user thấy màn trống,
  // không biết tiền đang ở đâu. Panel này giữ user luôn thấy trạng thái.
  if (state.status === 'success') {
    return (
      <Panel>
        <p style={{ color: colors.success, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          {t('crosschain.success_title')}{contributorName && ` — ${contributorName}`}
        </p>
        {state.relayTxHash && (
<a
            href={`https://testnet.arcscan.app/tx/${state.relayTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              marginBottom: 8,
              color: colors.primary,
              fontSize: 12,
              textDecoration: 'underline',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {t('crosschain.view_arc_tx', { hash: `${state.relayTxHash.slice(0, 10)}...${state.relayTxHash.slice(-8)}` })}
          </a>
        )}
        <p style={{ color: colors.textSecondary, fontSize: 13 }}>
          {t('crosschain.updating_list')}
        </p>
      </Panel>
    )
  }
  // ─── Success: lấp gap giữa "relay xong" và "danh sách hiện dòng mới" ──────
  // Không có panel này thì relay xong panel biến mất ngay, nhưng danh sách

  // ─── D2 — Error, 4 case ──────────────────────────────────────────────────
  if (state.status === 'error') {
    const { title, description, showRetry } = getErrorContent(state, chainDisplay.name, t)
    return (
      <Panel isError>
        <p style={{ color: colors.danger, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</p>
        <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>{description}</p>
        {(state.errorType === 'relay_failed' || state.errorType === 'attestation_delayed') && state.burnTxHash && (
<a
            href={`${chainDisplay.explorerBase}${state.burnTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'block',
              marginBottom: 12,
              color: colors.primary,
              fontSize: 12,
              textDecoration: 'underline',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            {t('crosschain.burn_tx_keep', { hash: state.burnTxHash })}
          </a>
        )}
        {state.errorType === 'insufficient_balance' && (
          <div style={{ marginBottom: 12 }}>
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', marginRight: 12, color: colors.primary, fontSize: 12, fontWeight: 600, textDecoration: 'underline' }}
            >
              {t('crosschain.get_test_usdc')}
            </a>
            {state.sourceChain && (
              <a
                href={GAS_FAUCET_URL[state.sourceChain]}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', color: colors.primary, fontSize: 12, fontWeight: 600, textDecoration: 'underline' }}
              >
                {t('crosschain.get_test_eth', { chain: chainDisplay.name })}
              </a>
            )}
            <p style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>
              {t('crosschain.faucet_limit_note')}
            </p>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {showRetry && (
            <button onClick={onRetry} style={buttonStyle(colors.buttonPrimary)}>
              {t('crosschain.retry')}
            </button>
          )}
          <button onClick={onDismiss} style={buttonStyle(colors.textMuted)}>
            {t('crosschain.dismiss')}
          </button>
        </div>
      </Panel>
    )
  }

  return null
}

function getErrorContent(state: CrossChainState, chainName: string, t: (key: string, options?: Record<string, unknown>) => string) {
  switch (state.errorType) {
    case 'insufficient_balance':
      return {
        title: t('crosschain.errors.insufficient_balance_title'),
        description: state.errorMessage ?? t('crosschain.errors.insufficient_balance_desc', { chain: chainName }),
        showRetry: true,
      }
    case 'user_rejected':
      return {
        title: t('crosschain.errors.user_rejected_title'),
        description: t('crosschain.errors.user_rejected_desc'),
        showRetry: true,
      }
    case 'burn_reverted':
      return {
        title: t('crosschain.errors.burn_reverted_title'),
        description: state.errorMessage ?? t('crosschain.errors.burn_reverted_desc', { chain: chainName }),
        showRetry: true,
      }
    case 'relay_failed':
      return {
        title: t('crosschain.errors.relay_failed_title'),
        description: t('crosschain.errors.relay_failed_desc', { chain: chainName }),
        showRetry: false,
      }
    // Chờ lâu bất thường (>30 phút), KHÔNG phải burn thất bại hay lỗi mạng — tiền
    // đã burn xong trên chainName, chỉ là Circle xử lý chậm hơn thường lệ (hiếm).
    // Không cho "Thử lại" vì sẽ burn lần 2, mất tiền oan — chỉ có thể chờ tiếp.
    case 'attestation_delayed':
      return {
        title: t('crosschain.errors.attestation_delayed_title'),
        description: state.errorMessage ?? t('crosschain.errors.attestation_delayed_desc', { chain: chainName }),
        showRetry: false,
      }
    default:
      return {
        title: t('crosschain.errors.default_title'),
        description: state.errorMessage ?? t('crosschain.errors.default_desc'),
        showRetry: true,
      }
  }
}

function Panel({ children, isError }: { children: React.ReactNode; isError?: boolean }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 14,
        borderRadius: 8,
        background: isError ? '#fef2f2' : colors.backgroundSubtle,
        border: `1px solid ${isError ? '#fecaca' : colors.borderLight}`,
      }}
    >
      {children}
    </div>
  )
}

function buttonStyle(bg: string): React.CSSProperties {
  return {
    fontSize: 13,
    fontWeight: 600,
    color: '#fff',
    background: bg,
    border: 'none',
    borderRadius: radius.button,
    padding: '8px 14px',
    cursor: 'pointer',
  }
}