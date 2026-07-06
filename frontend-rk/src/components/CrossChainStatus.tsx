import { CrossChainState } from '../hooks/useCrossChainPayment'
import { colors, radius } from '../styles/theme'

// Tên hiển thị + explorer URL theo từng chain nguồn — thêm chain mới chỉ cần thêm 1 dòng
const SOURCE_CHAIN_DISPLAY = {
  base: { name: 'Base Sepolia', explorerBase: 'https://sepolia.basescan.org/tx/' },
  arbitrum: { name: 'Arbitrum Sepolia', explorerBase: 'https://sepolia.arbiscan.io/tx/' },
  ethereum: { name: 'Ethereum Sepolia', explorerBase: 'https://sepolia.etherscan.io/tx/' },
} as const

function getChainDisplay(sourceChain: CrossChainState['sourceChain']) {
  return sourceChain ? SOURCE_CHAIN_DISPLAY[sourceChain] : { name: 'chain nguồn', explorerBase: '#' }
}

// D1 — Pending attestation: hiện khi đang chờ Circle ký xác nhận sau khi đã burn xong
// D2 — Error: hiện 1 trong 4 case, mỗi case có message + hành động phù hợp riêng
export function CrossChainStatusPanel({
    state,
    onRetry,
    onDismiss,
    contributorName,
  }: {
    state: CrossChainState
    onRetry: () => void
    onDismiss: () => void
    contributorName?: string
  }) {
  const chainDisplay = getChainDisplay(state.sourceChain)

  if (state.status === 'checking_balance' || state.status === 'burning') {
    return (
      <Panel>
        <p style={{ color: colors.textSecondary, fontSize: 13 }}>
          {state.status === 'checking_balance' ? 'Đang kiểm tra số dư...' : 'Đang chờ ký giao dịch burn trong ví...'}
        </p>
      </Panel>
    )
  }

  // ─── D1 — Pending attestation ───────────────────────────────────────────
  if (state.status === 'waiting_attestation' || state.status === 'relaying') {
    return (
      <Panel>
        <p style={{ color: colors.textPrimary, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
          ⏳ Đang xử lý...{contributorName && ` — ${contributorName}`}
        </p>
        <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 8 }}>
          Burn tx đã xác nhận trên {chainDisplay.name}.
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
            Xem tx burn: {state.burnTxHash.slice(0, 10)}...{state.burnTxHash.slice(-8)}
          </a>
        )}
        {/* relaying = ví đang bật popup: switch mạng sang Arc + ký payCrossChain.
            Phải nói rõ user cần KÝ, không thì tưởng hệ thống tự chạy rồi bỏ lỡ popup. */}
        {state.status === 'relaying' ? (
          <>
            <p style={{ color: colors.textPrimary, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
              ✍️ Mở ví và ký giao dịch để nhận tiền trên Arc
            </p>
            <p style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 4 }}>
              Circle đã xác nhận xong. Đây là bước cuối: ví sẽ hỏi chuyển mạng sang Arc Testnet,
              rồi ký 1 giao dịch để ghi nhận tiền vào bill — không ký thì tiền chưa tới nơi.
            </p>
          </>
        ) : (
          <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 4 }}>
            Đang chờ Circle ký attestation ("thường 8–20 giây").
          </p>
        )}
        <p style={{ color: colors.textMuted, fontSize: 12 }}>
          Tiền không mất — có thể đóng tab và quay lại sau, hệ thống sẽ tự tiếp tục.
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
          ✅ USDC đã tới Arc{contributorName && ` — ${contributorName}`}
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
            Xem tx trên Arc: {state.relayTxHash.slice(0, 10)}...{state.relayTxHash.slice(-8)}
          </a>
        )}
        <p style={{ color: colors.textSecondary, fontSize: 13 }}>
          Đang cập nhật danh sách người góp...
        </p>
      </Panel>
    )
  }
  // ─── Success: lấp gap giữa "relay xong" và "danh sách hiện dòng mới" ──────
  // Không có panel này thì relay xong panel biến mất ngay, nhưng danh sách
  
  // ─── D2 — Error, 4 case ──────────────────────────────────────────────────
  if (state.status === 'error') {
    const { title, description, showRetry } = getErrorContent(state, chainDisplay.name)
    return (
      <Panel isError>
        <p style={{ color: colors.danger, fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</p>
        <p style={{ color: colors.textSecondary, fontSize: 13, marginBottom: 12 }}>{description}</p>
        {state.errorType === 'relay_failed' && state.burnTxHash && (       
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
            Mã tx burn (giữ lại để đối chiếu): {state.burnTxHash}
          </a>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {showRetry && (
            <button onClick={onRetry} style={buttonStyle(colors.buttonPrimary)}>
              Thử lại
            </button>
          )}
          <button onClick={onDismiss} style={buttonStyle(colors.textMuted)}>
            Đóng
          </button>
        </div>
      </Panel>
    )
  }

  return null
}

function getErrorContent(state: CrossChainState, chainName: string) {
  switch (state.errorType) {
    case 'insufficient_balance':
      return {
        title: 'Số dư không đủ',
        description: state.errorMessage ?? `Số dư USDC trên ${chainName} không đủ để trả.`,
        showRetry: true,
      }
    case 'user_rejected':
      return {
        title: 'Đã huỷ giao dịch',
        description: 'Bạn đã từ chối ký trong ví. Không có gì bị mất, thử lại khi sẵn sàng.',
        showRetry: true,
      }
    case 'burn_reverted':
      return {
        title: 'Giao dịch burn thất bại',
        description: state.errorMessage ?? `Giao dịch trên ${chainName} bị revert.`,
        showRetry: true,
      }
    case 'relay_failed':
      return {
        title: 'Không hoàn tất được — cần hỗ trợ',
        description: `Tiền đã burn thành công trên ${chainName} nhưng chưa ghi nhận được trên Arc. Giữ lại mã tx bên dưới, liên hệ hỗ trợ để xử lý thủ công.`,
        showRetry: false,
      }
    default:
      return {
        title: 'Có lỗi xảy ra',
        description: state.errorMessage ?? 'Lỗi không xác định.',
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