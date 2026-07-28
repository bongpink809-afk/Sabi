// src/contexts/CircleWalletContext.tsx
// ─── Đăng nhập bằng email (Circle User-Controlled Wallets) ─────────────────
// Ví Circle KHÔNG expose EIP-1193 provider (đã verify từ source .d.ts thật của
// @circle-fin/w3s-pw-web-sdk) — wagmi's useWriteContract/useAccount không dùng
// được với loại ví này. Context này là lớp state RIÊNG, chạy song song với
// wagmi (không thay thế, không đụng wagmi.ts) — chỉ cho phần trả trực tiếp
// trên Arc (approve/payShare/paySlot). Cross-chain payCrossChain KHÔNG hỗ trợ
// ví Circle ở v1 (theo scope đã chốt), vẫn cần MetaMask cho luồng đó.
//
// userToken/encryptionKey là phiên đăng nhập ngắn hạn — CHỈ giữ trong React
// state, không bao giờ ghi localStorage/Firestore (mất khi đóng tab/reload,
// user cần đăng nhập lại — đây là chủ ý, không phải thiếu sót).
import { W3SSdk } from '@circle-fin/w3s-pw-web-sdk'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { saveEmailWalletMapping } from '../lib/firebase'

type CircleStatus = 'signed_out' | 'awaiting_otp' | 'awaiting_wallet_setup' | 'ready' | 'error'

interface CircleChallengeError {
  message?: string
}
interface CircleChallengeResult {
  status?: string
  type?: string
}
type ChallengeCallback = (error: CircleChallengeError | undefined, result: CircleChallengeResult | undefined) => void

interface CircleWalletState {
  status: CircleStatus
  email: string | null
  userToken: string | null
  encryptionKey: string | null
  walletAddress: `0x${string}` | null
  walletId: string | null
  error: string | null
}

interface CircleWalletContextValue extends CircleWalletState {
  startEmailLogin: (email: string) => Promise<void>
  logout: () => void
  runChallenge: (challengeId: string, onCompleted: ChallengeCallback) => void
}

const initialState: CircleWalletState = {
  status: 'signed_out',
  email: null,
  userToken: null,
  encryptionKey: null,
  walletAddress: null,
  walletId: null,
  error: null,
}

const CircleWalletContext = createContext<CircleWalletContextValue | null>(null)

const appId = () => process.env.NEXT_PUBLIC_CIRCLE_APP_ID ?? ''

async function fetchExistingWallet(userToken: string): Promise<{ id: string; address: string } | null> {
  const res = await fetch(`/api/circle/wallets?userToken=${encodeURIComponent(userToken)}`)
  if (!res.ok) return null
  const data = await res.json()
  return data.wallet ?? null
}

export function CircleWalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CircleWalletState>(initialState)
  const sdkRef = useRef<W3SSdk | null>(null)

  const getSdk = useCallback((): W3SSdk => {
    if (!sdkRef.current) {
      sdkRef.current = new W3SSdk({ appSettings: { appId: appId() } })
    }
    return sdkRef.current
  }, [])

  // Sau khi có userToken/encryptionKey: kiểm tra ví đã tồn tại chưa, chưa có
  // thì khởi tạo (SCA, Arc Testnet) rồi cho user đặt PIN qua sdk.execute().
  const setupWallet = useCallback(
    async (sdk: W3SSdk, email: string, userToken: string, encryptionKey: string) => {
      const finishWithWallet = async (wallet: { id: string; address: string } | null) => {
        if (!wallet) {
          setState((s) => ({ ...s, status: 'error', error: 'Không tạo được ví' }))
          return
        }
        setState((s) => ({
          ...s,
          status: 'ready',
          walletAddress: wallet.address as `0x${string}`,
          walletId: wallet.id,
        }))
        // Best-effort — lỗi ghi Firestore không được chặn đăng nhập.
        saveEmailWalletMapping(email, wallet.address, wallet.id).catch(() => {})
      }

      const existing = await fetchExistingWallet(userToken)
      if (existing) {
        await finishWithWallet(existing)
        return
      }

      const initRes = await fetch('/api/circle/wallets/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userToken }),
      })
      if (!initRes.ok) {
        setState((s) => ({ ...s, status: 'error', error: 'Không khởi tạo được ví' }))
        return
      }
      const { challengeId, alreadyInitialized } = await initRes.json()

      if (alreadyInitialized || !challengeId) {
        await finishWithWallet(await fetchExistingWallet(userToken))
        return
      }

      sdk.setAuthentication({ userToken, encryptionKey })
      sdk.execute(challengeId, async (error, result) => {
        if (error || result?.status !== 'COMPLETE') {
          setState((s) => ({ ...s, status: 'error', error: error?.message ?? 'Tạo ví thất bại' }))
          return
        }
        await finishWithWallet(await fetchExistingWallet(userToken))
      })
    },
    []
  )

  const startEmailLogin = useCallback(
    async (email: string) => {
      setState({ ...initialState, status: 'awaiting_otp', email })
      try {
        const sdk = getSdk()
        const deviceId = await sdk.getDeviceId()

        const initRes = await fetch('/api/circle/login-init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, deviceId }),
        })
        if (!initRes.ok) throw new Error('Không gửi được mã OTP')
        const { deviceToken, deviceEncryptionKey, otpToken } = await initRes.json()

        sdk.updateConfigs(
          {
            appSettings: { appId: appId() },
            loginConfigs: { deviceToken, deviceEncryptionKey, otpToken },
          },
          async (error, result) => {
            if (error || !result) {
              setState((s) => ({ ...s, status: 'error', error: error?.message ?? 'Đăng nhập thất bại' }))
              return
            }
            const { userToken, encryptionKey } = result as { userToken: string; encryptionKey: string }
            setState((s) => ({ ...s, status: 'awaiting_wallet_setup', userToken, encryptionKey }))
            await setupWallet(sdk, email, userToken, encryptionKey)
          }
        )
        sdk.verifyOtp()
      } catch (err) {
        setState((s) => ({ ...s, status: 'error', error: err instanceof Error ? err.message : 'Đăng nhập thất bại' }))
      }
    },
    [getSdk, setupWallet]
  )

  const logout = useCallback(() => {
    setState(initialState)
  }, [])

  // Dùng chung cho challenge tạo giao dịch (useCircleContractCall) — cần
  // setAuthentication lại mỗi lần vì SDK không tự giữ session giữa các lần gọi.
  const runChallenge = useCallback(
    (challengeId: string, onCompleted: ChallengeCallback) => {
      const sdk = getSdk()
      if (state.userToken && state.encryptionKey) {
        sdk.setAuthentication({ userToken: state.userToken, encryptionKey: state.encryptionKey })
      }
      sdk.execute(challengeId, onCompleted)
    },
    [getSdk, state.userToken, state.encryptionKey]
  )

  return (
    <CircleWalletContext.Provider value={{ ...state, startEmailLogin, logout, runChallenge }}>
      {children}
    </CircleWalletContext.Provider>
  )
}

export function useCircleWallet(): CircleWalletContextValue {
  const ctx = useContext(CircleWalletContext)
  if (!ctx) throw new Error('useCircleWallet phải dùng bên trong CircleWalletProvider')
  return ctx
}

// ─── Hook gọi 1 lệnh ghi contract qua ví Circle ─────────────────────────────
// Shape cố tình giống cặp useWriteContract+useWaitForTransactionReceipt của
// wagmi (execute/isPending/txHash/isSuccess/error) để chỗ merge state ở
// bill/[id].tsx không phải đổi cấu trúc khi thêm nhánh Circle.
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 30_000

interface CircleContractCallParams {
  contractAddress: `0x${string}`
  abiFunctionSignature: string
  abiParameters: string[]
}

export function useCircleContractCall() {
  const { userToken, walletId, runChallenge } = useCircleWallet()
  const [isPending, setIsPending] = useState(false)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined)
  const [isSuccess, setIsSuccess] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const reset = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    setIsPending(false)
    setTxHash(undefined)
    setIsSuccess(false)
    setError(null)
  }, [])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const pollTransactionStatus = useCallback(
    (walletIdForPoll: string) => {
      const startedAt = Date.now()
      pollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
          if (pollRef.current) clearInterval(pollRef.current)
          setIsPending(false)
          setError(new Error('Hết thời gian chờ xác nhận giao dịch'))
          return
        }
        try {
          const res = await fetch(
            `/api/circle/transaction-status?userToken=${encodeURIComponent(userToken ?? '')}&walletId=${encodeURIComponent(walletIdForPoll)}`
          )
          const data = await res.json()
          if (data.status === 'COMPLETE') {
            if (pollRef.current) clearInterval(pollRef.current)
            setIsPending(false)
            setIsSuccess(true)
            setTxHash(data.txHash ?? undefined)
          } else if (data.status === 'FAILED') {
            if (pollRef.current) clearInterval(pollRef.current)
            setIsPending(false)
            setError(new Error('Giao dịch thất bại'))
          }
        } catch {
          // Lỗi 1 lần poll — thử lại ở lần kế tiếp, không phải lỗi cuối cùng.
        }
      }, POLL_INTERVAL_MS)
    },
    [userToken]
  )

  const execute = useCallback(
    (params: CircleContractCallParams) => {
      if (!userToken || !walletId) {
        setError(new Error('Chưa đăng nhập ví email'))
        return
      }
      reset()
      setIsPending(true)
      ;(async () => {
        try {
          const res = await fetch('/api/circle/contract-execution', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userToken, walletId, ...params }),
          })
          if (!res.ok) throw new Error('Không tạo được giao dịch')
          const { challengeId } = await res.json()

          runChallenge(challengeId, (err, result) => {
            if (err || result?.status !== 'COMPLETE') {
              setIsPending(false)
              setError(new Error(err?.message ?? 'Giao dịch bị huỷ'))
              return
            }
            pollTransactionStatus(walletId)
          })
        } catch (err) {
          setIsPending(false)
          setError(err instanceof Error ? err : new Error('Lỗi không xác định'))
        }
      })()
    },
    [userToken, walletId, runChallenge, pollTransactionStatus, reset]
  )

  return { execute, isPending, txHash, isSuccess, error, reset }
}
