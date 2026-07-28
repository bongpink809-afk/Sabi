// Tạo challenge gọi 1 hàm contract bất kỳ (approve/payShare/paySlot) thay mặt
// ví Circle của user. Trả về challengeId — frontend gọi sdk.execute(challengeId)
// để user xác nhận PIN, Circle tự ký + broadcast.
import type { NextApiRequest, NextApiResponse } from 'next'
import { circleFetch, newIdempotencyKey } from '../../../lib/circleApi'

interface ContractExecutionResponse {
  challengeId: string
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { userToken, walletId, contractAddress, abiFunctionSignature, abiParameters } = req.body as {
    userToken?: string
    walletId?: string
    contractAddress?: string
    abiFunctionSignature?: string
    abiParameters?: string[]
  }
  if (!userToken || !walletId || !contractAddress || !abiFunctionSignature || !abiParameters) {
    return res.status(400).json({ error: 'Thiếu tham số' })
  }

  try {
    const data = await circleFetch<ContractExecutionResponse>('/v1/w3s/user/transactions/contractExecution', {
      method: 'POST',
      userToken,
      body: {
        idempotencyKey: newIdempotencyKey(),
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters,
        feeLevel: 'MEDIUM',
        blockchain: 'ARC-TESTNET',
      },
    })
    return res.status(200).json({ challengeId: data.challengeId })
  } catch (err) {
    console.error('[circle/contract-execution]', err)
    return res.status(500).json({ error: 'Không tạo được giao dịch' })
  }
}
