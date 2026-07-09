import { useState, useCallback, useEffect, useRef } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { useBurnCrossChain, SourceChain } from './useBurnCrossChain'
import { usePollAttestation, AttestationTimeoutError } from './usePollAttestation'
import { usePayCrossChain } from './usePayCrossChain'
import {
  baseSepolia,
  arbitrumSepolia,
  BASE_SEPOLIA_USDC_ADDRESS,
  ARBITRUM_SEPOLIA_USDC_ADDRESS,
  BASE_SEPOLIA_DOMAIN,
  ARBITRUM_SEPOLIA_DOMAIN,
  ETHEREUM_SEPOLIA_USDC_ADDRESS,
  ETHEREUM_SEPOLIA_DOMAIN,
  ERC20_ABI,
} from '../lib/contracts'

export type CrossChainStatus =
  | 'idle'
  | 'checking_balance'
  | 'burning'
  | 'waiting_attestation'
  | 'relaying'
  | 'success'
  | 'error'

export type CrossChainErrorType =
  | 'insufficient_balance'
  | 'user_rejected'
  | 'burn_reverted'
  | 'relay_failed'
  | 'attestation_delayed'

export interface CrossChainState {
  status: CrossChainStatus
  billId: string
  shareId?: number
  sourceChain?: SourceChain
  burnTxHash?: `0x${string}`
  relayTxHash?: `0x${string}`
  errorType?: CrossChainErrorType
  errorMessage?: string
}

// name + domain gộp cùng bảng balance-check — tránh lặp lại ternary base/arbitrum
// rải rác nhiều chỗ (dễ quên nhánh khi thêm chain thứ 3 như đã xảy ra với 'ethereum')
const BALANCE_CHECK_CONFIG = {
  base: { chainId: baseSepolia.id, usdcAddress: BASE_SEPOLIA_USDC_ADDRESS, domain: BASE_SEPOLIA_DOMAIN, name: 'Base Sepolia' },
  arbitrum: { chainId: arbitrumSepolia.id, usdcAddress: ARBITRUM_SEPOLIA_USDC_ADDRESS, domain: ARBITRUM_SEPOLIA_DOMAIN, name: 'Arbitrum Sepolia' },
  ethereum: { chainId: sepolia.id, usdcAddress: ETHEREUM_SEPOLIA_USDC_ADDRESS, domain: ETHEREUM_SEPOLIA_DOMAIN, name: 'Ethereum Sepolia' },
} as const

// OPEN_SLOT (shareId undefined) — ai cũng trả được, phải phân biệt theo địa chỉ ví,
// nếu không 2 ví khác nhau trên cùng máy sẽ đọc nhầm hash của nhau.
// ASSIGNED (có shareId) — mỗi share đã gắn cứng 1 ví, không cần phân biệt thêm.
const getStorageKey = (billId: string, shareId: number | undefined, address: `0x${string}` | undefined) => {
  if (shareId !== undefined) return `sabi_crosschain_${billId}_${shareId}`
  const addressPart = address ? address.toLowerCase() : 'noaddress'
  return `sabi_crosschain_${billId}_openslot_${addressPart}`
}

function loadState(
  billId: string,
  shareId: number | undefined,
  address: `0x${string}` | undefined
): CrossChainState | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(getStorageKey(billId, shareId, address))
  if (!raw) return null
  try {
    return JSON.parse(raw) as CrossChainState
  } catch {
    return null
  }
}

function saveState(state: CrossChainState, address: `0x${string}` | undefined) {
  if (typeof window === 'undefined') return
  localStorage.setItem(getStorageKey(state.billId, state.shareId, address), JSON.stringify(state))
}

function clearState(billId: string, shareId: number | undefined, address: `0x${string}` | undefined) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(getStorageKey(billId, shareId, address))
}

function classifyError(err: unknown): { type: CrossChainErrorType; message: string } {
  // Hết 30 phút chờ attestation KHÔNG phải burn thất bại hay lỗi mạng — tiền đã
  // burn thành công, chỉ là Circle xử lý lâu bất thường (hiếm, có thể do tạm dừng
  // attestation). Phải phân biệt với lỗi thật để không báo "thất bại" sai sự thật.
  if (err instanceof AttestationTimeoutError) {
    return {
      type: 'attestation_delayed',
      message: 'Circle đang xử lý lâu hơn bình thường. Tiền không mất — hệ thống sẽ tiếp tục chờ, quay lại sau.',
    }
  }

  const message = err instanceof Error ? err.message : String(err)

  if (message.includes('rejected') || (err as any)?.code === 4001) {
    return { type: 'user_rejected', message: 'Bạn đã huỷ giao dịch trong ví' }
  }
  if (message.includes('insufficient') || message.includes('exceeds balance')) {
    return { type: 'insufficient_balance', message: 'Số dư USDC không đủ' }
  }
  if (message.includes('payCrossChain reverted') || message.includes('Nonce already used')) {
    return { type: 'relay_failed', message: 'Không hoàn tất được trên Arc — tiền đã burn, cần hỗ trợ' }
  }
  return { type: 'burn_reverted', message: message.split('\n')[0] }
}

export function useCrossChainPayment(billId: bigint, shareId: number | undefined) {
  const { address } = useAccount()
  const publicClientBase = usePublicClient({ chainId: baseSepolia.id })
  const publicClientArbitrum = usePublicClient({ chainId: arbitrumSepolia.id })
  const publicClientEthereum = usePublicClient({ chainId: sepolia.id })
  const publicClients = { base: publicClientBase, arbitrum: publicClientArbitrum, ethereum: publicClientEthereum }
  const { burn } = useBurnCrossChain()
  const { poll, isDelayed } = usePollAttestation()
  const { relay } = usePayCrossChain()

  const billIdStr = billId.toString()

  const [state, setState] = useState<CrossChainState>(() => {
    return loadState(billIdStr, shareId, address) ?? { status: 'idle', billId: billIdStr, shareId }
  })

  const updateState = useCallback(
    (next: Partial<CrossChainState>) => {
      setState((prev) => {
        const merged = { ...prev, ...next }
        saveState(merged, address)
        return merged
      })
    },
    [address]
  )

  // Chặn xử lý trùng cho cùng 1 burn tx — effect resume có thể chạy 2 lần
  // (StrictMode, hoặc deps address đổi giữa chừng). 2 lệnh payCrossChain song song
  // từ cùng 1 ví sẽ đụng nonce → tx sau replace tx trước → hash hiển thị thành hash chết.
  const inFlightBurnTxRef = useRef<`0x${string}` | null>(null)

  const continueFromAttestation = async (burnTxHash: `0x${string}`, sourceChain: SourceChain) => {
    if (inFlightBurnTxRef.current === burnTxHash) return
    inFlightBurnTxRef.current = burnTxHash
    try {
      const domain = BALANCE_CHECK_CONFIG[sourceChain].domain
      const { message, attestation } = await poll(burnTxHash, domain)
      updateState({ status: 'relaying' })
      const relayTxHash = await relay(message, attestation)
      updateState({ status: 'success', relayTxHash })
      clearState(billIdStr, shareId, address)
    } catch (err) {
      const { type, message } = classifyError(err)
      if (type === 'user_rejected') {
        clearState(billIdStr, shareId, address)
        setState({ status: 'idle', billId: billIdStr, shareId })
        return
      }
      updateState({ status: 'error', errorType: type, errorMessage: message })
    } finally {
      inFlightBurnTxRef.current = null
    }
  }

  // Load lại state khi billId/shareId/address đổi (đổi ví cũng phải load lại đúng "ô nhớ" của ví đó)
  useEffect(() => {
    const saved = loadState(billIdStr, shareId, address)
    const nextState = saved ?? { status: 'idle' as const, billId: billIdStr, shareId }
    setState(nextState)
    // 'attestation_delayed' cũng phải tự tiếp tục chờ khi quay lại — đây là lời hứa
    // ngay trong message hiện cho user ("quay lại sau, hệ thống sẽ tự tiếp tục"),
    // không resume thì message nói dối trong khi tiền vẫn đang chờ Circle thật.
    const shouldResume =
      nextState.status === 'waiting_attestation' ||
      (nextState.status === 'error' && nextState.errorType === 'attestation_delayed')
    if (shouldResume && nextState.burnTxHash && nextState.sourceChain) {
      continueFromAttestation(nextState.burnTxHash, nextState.sourceChain)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billIdStr, shareId, address])

  const start = async (amount: bigint, sourceChain: SourceChain, shareIdOverride?: number) => {
    const effectiveShareId = shareIdOverride !== undefined ? shareIdOverride : shareId
    updateState({ status: 'checking_balance', sourceChain })
    try {
      const config = BALANCE_CHECK_CONFIG[sourceChain]
      const publicClient = publicClients[sourceChain]

      if (address && publicClient) {
        const balance = (await publicClient.readContract({
          address: config.usdcAddress,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint
        if (balance < amount) {
          updateState({
            status: 'error',
            errorType: 'insufficient_balance',
            errorMessage: `Số dư USDC trên ${BALANCE_CHECK_CONFIG[sourceChain].name} không đủ`,
          })
          return
        }
      }

      updateState({ status: 'burning' })

      // Timeout 45s cho cả bước burn — mobile wallet thường đóng popup mà không
      // trả error (khác PC), gây state 'burning' kẹt vĩnh viễn. Nếu quá 45s
      // không có phản hồi → tự reset về idle giống cơ chế approve ở trên.
      const BURN_TIMEOUT_MS = 45000
      const burnTxHash = await Promise.race([
        burn({ sourceChain, amount, billId, shareId: effectiveShareId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('timeout_user_rejected')), BURN_TIMEOUT_MS)
        ),
      ])

      updateState({ status: 'waiting_attestation', burnTxHash })

      await continueFromAttestation(burnTxHash, sourceChain)
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      // Timeout tự đặt → xử lý như user_rejected: reset về idle thay vì hiện lỗi
      if (errMsg === 'timeout_user_rejected') {
        clearState(billIdStr, shareId, address)
        setState({ status: 'idle', billId: billIdStr, shareId })
        return
      }
      const { type, message } = classifyError(err)
      if (type === 'user_rejected') {
        clearState(billIdStr, shareId, address)
        setState({ status: 'idle', billId: billIdStr, shareId })
        return
      }
      updateState({ status: 'error', errorType: type, errorMessage: message })
    }
  }

  const reset = () => {
    clearState(billIdStr, shareId, address)
    setState({ status: 'idle', billId: billIdStr, shareId })
  }

  return { state, start, reset, isDelayed }
}