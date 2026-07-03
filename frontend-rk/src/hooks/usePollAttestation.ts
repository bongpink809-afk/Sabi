import { useState, useCallback, useRef } from 'react'
import { BASE_SEPOLIA_DOMAIN } from '../lib/contracts'

// Response format từ Iris API — chỉ lấy field cần dùng
interface IrisMessage {
  message: `0x${string}`
  attestation: `0x${string}` | null // null = chưa attest xong
  status: 'pending_confirmations' | 'complete' | string
}

interface AttestationResult {
  message: `0x${string}`
  attestation: `0x${string}`
}

const IRIS_API_BASE = 'https://iris-api-sandbox.circle.com' // sandbox = testnet, KHÔNG dùng domain mainnet
const POLL_INTERVAL_MS = 5000 // 5 giây/lần — đủ nhanh để không làm user chờ lâu, không spam API
const MAX_POLL_ATTEMPTS = 360 // 360 × 5s = 30 phút, khớp thời gian standard finality đã ghi nhận

// Lỗi riêng khi hết thời gian chờ — để phân biệt với lỗi mạng thật sự (case 4 trong D2)
export class AttestationTimeoutError extends Error {
  constructor() {
    super('Hết thời gian chờ attestation (30 phút)')
    this.name = 'AttestationTimeoutError'
  }
}

export function usePollAttestation() {
  const [isPolling, setIsPolling] = useState(false)
  // dùng ref để hàm stop() gọi từ ngoài cắt được vòng lặp đang chạy dở
  const stopRef = useRef(false)

  const poll = useCallback(async (burnTxHash: `0x${string}`): Promise<AttestationResult> => {
    setIsPolling(true)
    stopRef.current = false

    try {
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        if (stopRef.current) {
          throw new Error('Đã hủy chờ attestation')
        }

        const res = await fetch(
          `${IRIS_API_BASE}/v2/messages/${BASE_SEPOLIA_DOMAIN}?transactionHash=${burnTxHash}`
        )

        // 404 nghĩa là Circle chưa index tx này — bình thường ở vài lần poll đầu, không phải lỗi
        if (res.ok) {
          const data = await res.json()
          const msg: IrisMessage | undefined = data.messages?.[0]

          if (msg?.status === 'complete' && msg.attestation) {
            return { message: msg.message, attestation: msg.attestation }
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }

      throw new AttestationTimeoutError()
    } finally {
      setIsPolling(false)
    }
  }, [])

  const stop = useCallback(() => {
    stopRef.current = true
  }, [])

  return { poll, stop, isPolling }
}