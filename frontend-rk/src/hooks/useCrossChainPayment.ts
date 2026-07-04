import { useState, useCallback, useEffect } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { useBurnCrossChain, SourceChain } from './useBurnCrossChain'
import { usePollAttestation } from './usePollAttestation'
import { usePayCrossChain } from './usePayCrossChain'
import {
  baseSepolia,
  arbitrumSepolia,
  BASE_SEPOLIA_USDC_ADDRESS,
  ARBITRUM_SEPOLIA_USDC_ADDRESS,
  BASE_SEPOLIA_DOMAIN,
  ARBITRUM_SEPOLIA_DOMAIN,
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
  | 'relay_failed' // attestation timeout hoặc payCrossChain revert — tiền đã burn, cần lưu vết

export interface CrossChainState {
  status: CrossChainStatus
  billId: string
  shareId?: number
  sourceChain?: 'base' | 'arbitrum'
  burnTxHash?: `0x${string}`
  relayTxHash?: `0x${string}`
  errorType?: CrossChainErrorType
  errorMessage?: string
}

// Cấu hình theo từng chain nguồn — thêm chain mới chỉ cần thêm 1 dòng vào đây
const BALANCE_CHECK_CONFIG = {
  base: { chainId: baseSepolia.id, usdcAddress: BASE_SEPOLIA_USDC_ADDRESS },
  arbitrum: { chainId: arbitrumSepolia.id, usdcAddress: ARBITRUM_SEPOLIA_USDC_ADDRESS },
} as const

const getStorageKey = (billId: string, shareId?: number) =>
  `sabi_crosschain_${billId}_${shareId ?? 'openslot'}`

function loadState(billId: string, shareId?: number): CrossChainState | null {
  if (typeof window === 'undefined') return null
  const raw = localStorage.getItem(getStorageKey(billId, shareId))
  if (!raw) return null
  try {
    return JSON.parse(raw) as CrossChainState
  } catch {
    return null
  }
}

function saveState(state: CrossChainState) {
  if (typeof window === 'undefined') return
  localStorage.setItem(getStorageKey(state.billId, state.shareId), JSON.stringify(state))
}

function clearState(billId: string, shareId?: number) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(getStorageKey(billId, shareId))
}

function classifyError(err: unknown): { type: CrossChainErrorType; message: string } {
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
  const { burn } = useBurnCrossChain()
  const { poll } = usePollAttestation()
  const { relay } = usePayCrossChain()

  const billIdStr = billId.toString()

  const [state, setState] = useState<CrossChainState>(() => {
    return loadState(billIdStr, shareId) ?? { status: 'idle', billId: billIdStr, shareId }
  })

  const updateState = useCallback((next: Partial<CrossChainState>) => {
    setState((prev) => {
      const merged = { ...prev, ...next }
      saveState(merged)
      return merged
    })
  }, [])

  const continueFromAttestation = async (burnTxHash: `0x${string}`, sourceChain: SourceChain) => {
    try {
      const domain = sourceChain === 'base' ? BASE_SEPOLIA_DOMAIN : ARBITRUM_SEPOLIA_DOMAIN
      const { message, attestation } = await poll(burnTxHash, domain)
      updateState({ status: 'relaying' })
      const relayTxHash = await relay(message, attestation)
      updateState({ status: 'success', relayTxHash })
      clearState(billIdStr, shareId)
    } catch (err) {
      const { type, message } = classifyError(err)
      if (type === 'user_rejected') {
        // Từ chối ký — không mất gì, lặng lẽ về trạng thái ban đầu, không hiện cảnh báo
        clearState(billIdStr, shareId)
        setState({ status: 'idle', billId: billIdStr, shareId })
        return
      }
      updateState({ status: 'error', errorType: type, errorMessage: message })
    }
  }

    // Load lại state khi billId/shareId đổi (Next.js: billId có thể tạm là 0n ở lần render đầu,
    // cần tự sửa lại billId đúng trong state khi giá trị thật từ URL xuất hiện)
    // + tự tiếp tục poll nếu đang dở waiting_attestation
    useEffect(() => {
      const saved = loadState(billIdStr, shareId)
      const nextState = saved ?? { status: 'idle' as const, billId: billIdStr, shareId }
      setState(nextState)
      if (nextState.status === 'waiting_attestation' && nextState.burnTxHash && nextState.sourceChain) {
        continueFromAttestation(nextState.burnTxHash, nextState.sourceChain)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [billIdStr, shareId])

  // sourceChain giờ bắt buộc truyền vào — cho biết burn từ Base Sepolia hay Arbitrum Sepolia
      const start = async (amount: bigint, sourceChain: SourceChain, shareIdOverride?: number) => {
      const effectiveShareId = shareIdOverride !== undefined ? shareIdOverride : shareId
      updateState({ status: 'checking_balance', sourceChain })
      try {
      const config = BALANCE_CHECK_CONFIG[sourceChain]
      const publicClient = sourceChain === 'base' ? publicClientBase : publicClientArbitrum

      // Guard: check balance TRƯỚC khi mở ví ký — tránh user ký xong mới biết thiếu tiền
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
            errorMessage: `Số dư USDC trên ${sourceChain === 'base' ? 'Base Sepolia' : 'Arbitrum Sepolia'} không đủ`,
          })
          return
        }
      }

      updateState({ status: 'burning' })

      const BURN_TIMEOUT_MS = 45000 // 45 giây không phản hồi → coi như huỷ
      const burnTxHash = await Promise.race([
        burn({ sourceChain, amount, billId, shareId: effectiveShareId }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Hết thời gian chờ ký giao dịch burn')), BURN_TIMEOUT_MS)
        ),
      ])

      updateState({ status: 'waiting_attestation', burnTxHash })

      await continueFromAttestation(burnTxHash, sourceChain)
    } catch (err) {
      const { type, message } = classifyError(err)
      if (type === 'user_rejected') {
        clearState(billIdStr, shareId)
        setState({ status: 'idle', billId: billIdStr, shareId })
        return
      }
      updateState({ status: 'error', errorType: type, errorMessage: message })
    }
  }

  const reset = () => {
    clearState(billIdStr, shareId)
    setState({ status: 'idle', billId: billIdStr, shareId })
  }

  return { state, start, reset }
}