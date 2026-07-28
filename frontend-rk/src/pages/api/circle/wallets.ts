// Lấy ví Circle hiện có của user (đã login, có userToken). Lọc đúng ví trên
// ARC-TESTNET — user có thể có nhiều ví nếu app mở rộng blockchain sau này.
import type { NextApiRequest, NextApiResponse } from 'next'
import { circleFetch } from '../../../lib/circleApi'

interface CircleWallet {
  id: string
  address: string
  blockchain: string
}

interface WalletsListResponse {
  wallets: CircleWallet[]
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const userToken = req.query.userToken
  if (typeof userToken !== 'string' || !userToken) return res.status(400).json({ error: 'Thiếu userToken' })

  try {
    const data = await circleFetch<WalletsListResponse>('/v1/w3s/wallets', { userToken })
    const wallet = data.wallets.find((w) => w.blockchain === 'ARC-TESTNET')
    return res.status(200).json({ wallet: wallet ? { id: wallet.id, address: wallet.address } : null })
  } catch (err) {
    console.error('[circle/wallets]', err)
    return res.status(500).json({ error: 'Không lấy được danh sách ví' })
  }
}
