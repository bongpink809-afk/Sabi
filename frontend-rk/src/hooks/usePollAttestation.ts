import { useState, useCallback, useRef } from 'react'

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
// Ngưỡng coi là "chờ bất thường lâu" — dài hơn nhiều so với 8-20s bình thường của
// Fast Transfer, đủ để loại trừ khả năng chỉ đang chờ bình thường. Circle hiếm khi
// tạm dừng attestation nhưng nếu xảy ra, UI cần nói rõ đây KHÔNG phải lỗi.
const DELAYED_THRESHOLD_ATTEMPTS = 60 // 60 × 5s = 5 phút

// Lỗi riêng khi hết thời gian chờ — để phân biệt với lỗi mạng thật sự (case 4 trong D2)
export class AttestationTimeoutError extends Error {
  constructor() {
    super('Hết thời gian chờ attestation (30 phút)')
    this.name = 'AttestationTimeoutError'
  }
}

export function usePollAttestation() {
  const [isPolling, setIsPolling] = useState(false)
  // true khi đã chờ qua DELAYED_THRESHOLD_ATTEMPTS — báo hiệu cho UI hiện thông
  // báo trung tính "đang xử lý lâu hơn bình thường", không phải lỗi
  const [isDelayed, setIsDelayed] = useState(false)
  // dùng ref để hàm stop() gọi từ ngoài cắt được vòng lặp đang chạy dở
  const stopRef = useRef(false)

  // domain: domain CCTP của CHAIN NGUỒN (nơi đã burn) — Base Sepolia = 6, Arbitrum Sepolia = 3
  // KHÔNG được hard-code, vì mỗi chain nguồn có domain khác nhau
  const poll = useCallback(async (burnTxHash: `0x${string}`, domain: number): Promise<AttestationResult> => {
    setIsPolling(true)
    setIsDelayed(false)
    stopRef.current = false

    try {
      for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
        if (stopRef.current) {
          throw new Error('Đã hủy chờ attestation')
        }
        if (attempt === DELAYED_THRESHOLD_ATTEMPTS) {
          setIsDelayed(true)
        }

        const res = await fetch(
          `${IRIS_API_BASE}/v2/messages/${domain}?transactionHash=${burnTxHash}`
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

  return { poll, stop, isPolling, isDelayed }
}