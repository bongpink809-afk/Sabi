import { encodeAbiParameters, pad, parseAbiParameters } from 'viem'
import { SABI_BILL_ADDRESS } from './contracts'

// hookData: OPEN_SLOT chỉ có billId, ASSIGNED có thêm shareId
// Format phải khớp CHÍNH XÁC với decode trong SabiBill.payCrossChain (Solidity)
export function encodeHookData(billId: bigint, shareId?: number): `0x${string}` {
  if (shareId !== undefined) {
    return encodeAbiParameters(parseAbiParameters('uint256, uint256'), [billId, BigInt(shareId)])
  }
  return encodeAbiParameters(parseAbiParameters('uint256'), [billId])
}

// mintRecipient của CCTP là bytes32 — pad địa chỉ 20 byte của SabiBill về 32 byte
// Đây chính là chỗ burn.sh làm SAI (pad HOOK_RECEIVER thay vì SabiBill)
export const SABI_BILL_MINT_RECIPIENT = pad(SABI_BILL_ADDRESS, { size: 32 })

// destinationCaller = 0x0 → ai relay cũng được, không giới hạn người gọi payCrossChain
export const DESTINATION_CALLER_ANY = pad('0x00', { size: 32 })

// Standard transfer (không phải fast) — PHẢI đi cùng nhau, sai 1 trong 2 sẽ bị tính phí hoặc lỗi
// Fast Transfer: Circle attest khi đạt soft finality (~8-20s)
// thay vì chờ hard finality (15-30 phút). minFinality <= 500 = Fast.
export const FAST_MIN_FINALITY = 500

// Trần phí Fast — Circle chỉ trừ phí THỰC theo biểu phí (rất nhỏ),
// maxFee chỉ là mức trần cho phép. Đặt 1% để không bao giờ bị
// fallback về Standard. Contract đo balance delta nên mức phí nào cũng xử lý đúng.
export function fastMaxFee(amount: bigint): bigint {
  return amount / 100n + 1n // +1n để amount quá nhỏ không ra 0 (maxFee=0 là fallback Standard)
}