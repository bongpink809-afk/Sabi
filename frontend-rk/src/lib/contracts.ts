import { SabiBillABI } from './SabiBillABI'

export { baseSepolia } from 'viem/chains'

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

  // ─── Base Sepolia (nguồn burn) ─────────────────────────────────────────
  export const BASE_SEPOLIA_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const
  export const BASE_SEPOLIA_DOMAIN = 6 // Circle domain ID, không phải chainId EVM

  export const BASE_TOKEN_MESSENGER_ADDRESS = '0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA' as const

  // ─── Arc Testnet (đích relay) ───────────────────────────────────────────
  export const ARC_DOMAIN = 26 // Circle domain ID
  export const ARC_MESSAGE_TRANSMITTER_ADDRESS = '0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275' as const

  // TokenMessengerV2 ABI — chỉ cần depositForBurnWithHook cho hàm burn phía frontend
  export const TOKEN_MESSENGER_V2_ABI = [
    {
      name: 'depositForBurnWithHook',
      type: 'function',
      stateMutability: 'nonpayable',
      inputs: [
        { name: 'amount', type: 'uint256' },
        { name: 'destinationDomain', type: 'uint32' },
        { name: 'mintRecipient', type: 'bytes32' },
        { name: 'burnToken', type: 'address' },
        { name: 'destinationCaller', type: 'bytes32' },
        { name: 'maxFee', type: 'uint256' },
        { name: 'minFinalityThreshold', type: 'uint32' },
        { name: 'hookData', type: 'bytes' },
      ],
      outputs: [],
    },
  ] as const