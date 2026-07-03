import { useState, useCallback, useEffect } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { useBurnCrossChain } from './useBurnCrossChain'
import { usePollAttestation } from './usePollAttestation'
import { usePayCrossChain } from './usePayCrossChain'
import { baseSepolia, BASE_SEPOLIA_USDC_ADDRESS, ERC20_ABI } from '../lib/contracts'

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
  burnTxHash?: `0x${string}`
  relayTxHash?: `0x${string}`
  errorType?: CrossChainErrorType
  errorMessage?: string
}

const getStorageKey = (billId: string, shareId?: number) =>
  `sabi_crosschain_${billId}_${shareId ?? 'openslot'}`

function loadState(billId: string, shareId?: number): CrossChainState | null {
  if (typeof window === 'undefined') return null // SSR — chưa có localStorage lúc render trên server
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

// Phân loại lỗi thô thành 4 case đã chốt cho D2 — dựa trên các lỗi thật đã gặp trong phiên test
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

  const continueFromAttestation = async (burnTxHash: `0x${string}`) => {
    try {
      const { message, attestation } = await poll(burnTxHash)
      updateState({ status: 'relaying' })
      const relayTxHash = await relay(message, attestation)
      updateState({ status: 'success', relayTxHash })
      clearState(billIdStr, shareId)
    } catch (err) {
      const { type, message } = classifyError(err)
      updateState({ status: 'error', errorType: type, errorMessage: message })
    }
  }

  // F5 lại trang lúc đang chờ attestation — tự tiếp tục poll, không bắt burn lại
  useEffect(() => {
    if (state.status === 'waiting_attestation' && state.burnTxHash) {
      continueFromAttestation(state.burnTxHash)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const start = async (amount: bigint) => {
    updateState({ status: 'checking_balance' })
    try {
      // Guard: check balance TRƯỚC khi mở ví ký — tránh user ký xong mới biết thiếu tiền
      if (address && publicClientBase) {
        const balance = (await publicClientBase.readContract({
          address: BASE_SEPOLIA_USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint
        if (balance < amount) {
          updateState({
            status: 'error',
            errorType: 'insufficient_balance',
            errorMessage: 'Số dư USDC trên Base Sepolia không đủ',
          })
          return
        }
      }

      updateState({ status: 'burning' })
      const burnTxHash = await burn({ amount, billId, shareId })
      updateState({ status: 'waiting_attestation', burnTxHash })

      await continueFromAttestation(burnTxHash)
    } catch (err) {
      const { type, message } = classifyError(err)
      updateState({ status: 'error', errorType: type, errorMessage: message })
    }
  }

  const reset = () => {
    clearState(billIdStr, shareId)
    setState({ status: 'idle', billId: billIdStr, shareId })
  }

  return { state, start, reset }
}