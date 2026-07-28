// Khởi tạo ví Circle (SCA) trên Arc Testnet cho user mới login lần đầu.
// Trả về challengeId để frontend gọi sdk.execute() cho user đặt PIN.
// Nếu user đã có ví từ trước, Circle trả lỗi 155106 (userWasInitialized) —
// KHÔNG phải lỗi thật, coi như "đã init rồi", để frontend bỏ qua bước challenge
// và load thẳng ví cũ qua /api/circle/wallets.
import type { NextApiRequest, NextApiResponse } from 'next'
import { circleFetch, newIdempotencyKey, CircleApiError, CIRCLE_ERROR_USER_WAS_INITIALIZED } from '../../../../lib/circleApi'

interface InitializeResponse {
  challengeId: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userToken } = req.body as { userToken?: string }
  if (!userToken) return res.status(400).json({ error: 'Thiếu userToken' })

  try {
    const data = await circleFetch<InitializeResponse>('/v1/w3s/user/initialize', {
      method: 'POST',
      userToken,
      body: {
        idempotencyKey: newIdempotencyKey(),
        accountType: 'SCA',
        blockchains: ['ARC-TESTNET'],
      },
    })
    return res.status(200).json({ challengeId: data.challengeId, alreadyInitialized: false })
  } catch (err) {
    if (err instanceof CircleApiError && err.code === CIRCLE_ERROR_USER_WAS_INITIALIZED) {
      return res.status(200).json({ challengeId: null, alreadyInitialized: true })
    }
    console.error('[circle/wallets/initialize]', err)
    return res.status(500).json({ error: 'Không khởi tạo được ví' })
  }
}
