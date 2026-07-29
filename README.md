# Sabi — Cross-Chain Bill Splitting on Arc

Split a bill with friends, get paid back in USDC — even if everyone's on a different chain.

Live demo: https://sabi-arc.vercel.app
Demo video: [add link once recorded]
Network: Arc Testnet (chain id 5042002)
Contract (SabiBill): [0x192963eBcC9f39C0057597CF3AA7d97c99a83c75](https://explorer.arc-testnet.circle.com/address/0x192963eBcC9f39C0057597CF3AA7d97c99a83c75) (update link to match actual Arc Testnet explorer)

---

## Problem

Splitting a bill across a group is already annoying. Splitting it when your friends hold USDC on different chains (Base, Arbitrum, Ethereum) is worse — someone has to bridge manually, track who paid, and reconcile it after the fact.

## What Sabi does

Sabi is a bill-splitting dApp where each participant pays from whatever chain they already hold USDC on. Payments settle natively on Arc through Circle's CCTP V2, with no manual bridging step.

Two bill modes:

| Mode | Behavior |
|---|---|
| ASSIGNED | Organizer sets a fixed amount per named person |
| OPEN_SLOT | Equal split, or open contribution from anyone who joins |

## Cross-chain payment flow

1. Organizer creates a bill on Arc.
2. Participant pays from Base Sepolia, Arbitrum Sepolia, or Ethereum Sepolia — no need to hold USDC on Arc directly.
3. USDC is burned on the source chain and minted on Arc via CCTP V2 Fast Transfer (~20 seconds).
4. SabiBill calls `receiveMessage()` on Arc's MessageTransmitterV2 itself and decodes the attestation — payment is recorded and marked paid automatically, no separate relayer step for the user to wait on.
5. Payment state persists client-side, so closing the tab mid-transfer doesn't lose progress — reopening the bill resumes from where it left off.

## Tech stack

| Layer | Tech |
|---|---|
| Contracts | Solidity, Foundry |
| Frontend | Next.js 16 (Pages Router), TypeScript |
| Wallet / chain | wagmi v2, viem, RainbowKit |
| Cross-chain | Circle CCTP V2 (TokenMessengerV2, MessageTransmitterV2) |
| Data sync | Firebase Firestore (bill titles, profile names), Firebase Storage (avatars) |
| i18n | next-i18next (Vietnamese / English) |

Wallet addresses are never stored on-chain — all identity/display data is frontend-only, synced via Firestore for cross-device access.

## Getting started

### Contracts

```shell
forge install
forge build
forge test
```

### Frontend

```shell
cd frontend-rk
npm install
cp .env.example .env.local   # fill in Firebase config, see below
npm run dev
```

Required environment variables (`frontend-rk/.env.local`):

```
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
```

Optional — Circle email login (currently feature-flagged off, MetaMask is the default and only active login path):

```
CIRCLE_API_KEY=
NEXT_PUBLIC_CIRCLE_APP_ID=
NEXT_PUBLIC_ENABLE_CIRCLE_LOGIN=
```

## Repo structure

```
src/            SabiBill.sol and interfaces (Foundry contracts)
test/           Foundry unit + integration tests
script/         Deployment scripts
frontend-rk/    Next.js app (Pages Router)
memory/, spec/  Project working notes and original spec
```

## Known limitations

- Testnet only — not audited, not intended for mainnet funds.
- Circle email login (User-Controlled Wallets) is built but disabled by feature flag; MetaMask is the supported login method for this submission.
- No swap or standalone bridge feature — out of scope by design, kept focused on bill splitting.

## License

[add license if applicable]
