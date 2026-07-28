// Bước 1 đăng nhập email: yêu cầu Circle gửi mã OTP tới email người dùng.
// Trả về deviceToken/deviceEncryptionKey/otpToken — 3 field này frontend đưa
// thẳng vào sdk.updateConfigs({ loginConfigs: {...} }) rồi gọi sdk.verifyOtp().
import type { NextApiRequest, NextApiResponse } from 'next'
import { circleFetch, newIdempotencyKey } from '../../../lib/circleApi'

interface LoginInitResponse {
  deviceToken: string
  deviceEncryptionKey: string
  otpToken: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, deviceId } = req.body as { email?: string; deviceId?: string }
  if (!email || !deviceId) return res.status(400).json({ error: 'Thiếu email hoặc deviceId' })

  try {
    const data = await circleFetch<LoginInitResponse>('/v1/w3s/users/email/token', {
      method: 'POST',
      body: { idempotencyKey: newIdempotencyKey(), deviceId, email },
    })
    return res.status(200).json(data)
  } catch (err) {
    console.error('[circle/login-init]', err)
    return res.status(500).json({ error: 'Không gửi được mã OTP' })
  }
}
