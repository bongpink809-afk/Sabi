// Tra cứu giao dịch gần nhất của 1 ví Circle sau khi challenge contractExecution
// hoàn tất — cần vì ChallengeResult trả về từ sdk.execute() không kèm sẵn tx hash
// cho loại challenge CREATE_TRANSACTION (transaction ghi nhận bất đồng bộ phía Circle).
//
// CHƯA VERIFY được field response thật (docs không cho ví dụ JSON đầy đủ) — lần đầu
// gọi thật với sandbox, log nguyên `raw` trả về dưới đây rồi chỉnh lại field mapping
// (`state`/`txHash`) cho đúng trước khi bỏ log này đi. Interface { status, txHash }
// trả ra ngoài route này giữ nguyên bất kể field Circle thật tên gì.
import type { NextApiRequest, NextApiResponse } from 'next'
import { circleFetch } from '../../../lib/circleApi'

interface CircleTransaction {
  id: string
  txHash?: string
  state: string // TODO: xác nhận giá trị thật (đoán: INITIATED/PENDING/CONFIRMED/COMPLETE/FAILED)
  createDate: string
}

interface TransactionsListResponse {
  transactions: CircleTransaction[]
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { userToken, walletId } = req.query
  if (typeof userToken !== 'string' || typeof walletId !== 'string' || !userToken || !walletId) {
    return res.status(400).json({ error: 'Thiếu userToken hoặc walletId' })
  }

  try {
    const data = await circleFetch<TransactionsListResponse>(
      `/v1/w3s/transactions?walletIds=${encodeURIComponent(walletId)}`,
      { userToken }
    )
    const latest = data.transactions?.[0]

    // TODO: xoá log này sau khi verify xong field mapping thật với sandbox Circle.
    console.log('[circle/transaction-status] raw latest tx:', JSON.stringify(latest))

    if (!latest) return res.status(200).json({ status: 'PENDING', txHash: null })

    const isTerminalSuccess = latest.state === 'COMPLETE' || latest.state === 'CONFIRMED'
    const isFailed = latest.state === 'FAILED' || latest.state === 'CANCELLED'
    const status = isTerminalSuccess ? 'COMPLETE' : isFailed ? 'FAILED' : 'PENDING'

    return res.status(200).json({ status, txHash: latest.txHash ?? null })
  } catch (err) {
    console.error('[circle/transaction-status]', err)
    return res.status(500).json({ error: 'Không tra được trạng thái giao dịch' })
  }
}
