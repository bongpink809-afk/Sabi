const SabiBillABI = require('./SabiBillABI.json')

export const SABI_BILL_ADDRESS = '0xFbb7765FC0150C5D41bF85EedEb4a45747884Ce5' as const

export const SABI_BILL_ABI = SabiBillABI

// Arc Testnet USDC
export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const

// USDC ABI — chỉ cần approve + allowance
export const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const