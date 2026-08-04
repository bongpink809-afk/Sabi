// Đồng bộ dữ liệu on-chain (bill/share/contribution) từ contract SabiBill lên
// Firestore — frontend đọc thẳng từ đây thay vì tự gọi RPC (getBill/getShare/
// getContractEvents), tránh rate-limit của RPC public khi user mở trang.
//
// Chạy thủ công trước mỗi lần demo (không cron): node scripts/sync-firestore.mjs
// (hoặc npm run sync-firestore, chạy trong thư mục frontend-rk).
//
// Lần đầu chạy (chưa có doc _meta/sync trên Firestore): nạp sẵn
// public/data/onchain-history-seed.json (đã quét sẵn ~4.27 triệu block, xem
// build-history-seed.mjs) làm log nền, rồi quét tiếp phần còn thiếu tới block
// mới nhất — đỡ phải quét lại từ đầu. Các lần sau chỉ quét tiếp từ checkpoint.
//
// Mỗi bill có log mới sẽ được đọc lại TƯƠI từ chain (getBill/shareCount/
// getShare) — event BillCreated không có đủ amountPerSlot/numSlots/
// matchedSlotsCount/extraReceived, và event SharePaid chỉ tồn tại cho share
// ĐÃ trả (share chưa trả không có log nào), nên không thể suy ra đủ dữ liệu
// chỉ từ việc decode event như bản seed cũ.

import dotenv from 'dotenv'
import { createPublicClient, http } from 'viem'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })

const RPC_URL = 'https://rpc.testnet.arc.network'
const ADDRESS = '0x192963eBcC9f39C0057597CF3AA7d97c99a83c75'
const DEPLOY_BLOCK = 50295105n
const CHUNK = 10000n
const SEED_PATH = path.join(__dirname, '..', 'public', 'data', 'onchain-history-seed.json')

const BILL_MODE_ASSIGNED = 0

// ─── ABI — chỉ phần cần cho script này (event quét + read chốt số liệu) ────
const ABI = [
  {
    type: 'event',
    name: 'BillCreated',
    inputs: [
      { name: 'billId', type: 'uint256', indexed: true },
      { name: 'organizer', type: 'address', indexed: true },
      { name: 'mode', type: 'uint8', indexed: false },
      { name: 'totalAmount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SharePaid',
    inputs: [
      { name: 'billId', type: 'uint256', indexed: true },
      { name: 'shareId', type: 'uint256', indexed: true },
      { name: 'payer', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'SlotFilled',
    inputs: [
      { name: 'billId', type: 'uint256', indexed: true },
      { name: 'payer', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'matched', type: 'bool', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getBill',
    stateMutability: 'view',
    inputs: [{ name: 'billId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'organizer', type: 'address' },
          { name: 'mode', type: 'uint8' },
          { name: 'totalAmount', type: 'uint256' },
          { name: 'amountPerSlot', type: 'uint256' },
          { name: 'numSlots', type: 'uint256' },
          { name: 'matchedSlotsCount', type: 'uint256' },
          { name: 'extraReceived', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'shareCount',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getShare',
    stateMutability: 'view',
    inputs: [
      { name: 'billId', type: 'uint256' },
      { name: 'shareId', type: 'uint256' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'amount', type: 'uint256' },
          { name: 'paid', type: 'bool' },
        ],
      },
    ],
  },
]

const client = createPublicClient({ transport: http(RPC_URL) })

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }
// Cả 2 dạng vào đây đều hợp lệ: bigint (log đọc trực tiếp từ chain) hoặc
// string/number (log nạp từ file seed JSON, đã bị serialize trước đó).
const toBig = (v) => (typeof v === 'bigint' ? v : BigInt(v))
const toNum = (v) => Number(v)

async function scanChunk(fromBlock, toBlock) {
  let attempt = 0
  for (;;) {
    attempt++
    try {
      return await client.getContractEvents({ address: ADDRESS, abi: ABI, fromBlock, toBlock })
    } catch (e) {
      const wait = Math.min(2000 * attempt, 30000)
      console.log(`  [retry ${attempt}] range [${fromBlock},${toBlock}]: ${e.shortMessage || e.message} — chờ ${wait}ms`)
      await sleep(wait)
    }
  }
}

async function readWithRetry(functionName, args) {
  let attempt = 0
  for (;;) {
    attempt++
    try {
      return await client.readContract({ address: ADDRESS, abi: ABI, functionName, args })
    } catch (e) {
      const wait = Math.min(2000 * attempt, 30000)
      console.log(`  [retry ${attempt}] ${functionName}(${args}): ${e.shortMessage || e.message} — chờ ${wait}ms`)
      await sleep(wait)
    }
  }
}

// Định danh duy nhất thật sự của 1 log là (transactionHash, logIndex) — giống
// hệt dedupeLogs trong src/lib/eventScan.ts, để chạy script nhiều lần hoặc
// khoảng quét chồng lấn (seed cutoff ↔ catch-up) không tạo log trùng.
function dedupeLogs(logs) {
  const map = new Map()
  for (const log of logs) map.set(`${log.transactionHash}:${log.logIndex}`, log)
  return Array.from(map.values())
}

function loadSeedLogs() {
  if (!existsSync(SEED_PATH)) return null
  try {
    return JSON.parse(readFileSync(SEED_PATH, 'utf-8'))
  } catch {
    return null
  }
}

async function main() {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error('Thiếu FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY / NEXT_PUBLIC_FIREBASE_PROJECT_ID trong .env.local')
    process.exit(1)
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  const db = getFirestore()

  const metaRef = db.collection('_meta').doc('sync')
  const metaSnap = await metaRef.get()
  const isFirstRun = !metaSnap.exists

  const latestBlock = await client.getBlockNumber()
  let seedLogs = []
  let fromBlock = DEPLOY_BLOCK

  if (isFirstRun) {
    const seed = loadSeedLogs()
    if (seed) {
      seedLogs = seed.logs
      fromBlock = BigInt(seed.cutoffBlock) + 1n
      console.log(`Lần đầu chạy — nạp ${seedLogs.length} log nền từ seed (cutoff block ${seed.cutoffBlock})`)
    } else {
      console.log('Lần đầu chạy — không thấy file seed, quét từ block deploy')
    }
  } else {
    fromBlock = BigInt(metaSnap.data().lastIndexedBlock) + 1n
  }

  console.log(`Quét block [${fromBlock}, ${latestBlock}]`)
  const newLogs = []
  let cursor = fromBlock
  while (cursor <= latestBlock) {
    const toBlock = cursor + CHUNK - 1n > latestBlock ? latestBlock : cursor + CHUNK - 1n
    const chunkLogs = await scanChunk(cursor, toBlock)
    if (chunkLogs.length > 0) {
      console.log(`  +${chunkLogs.length} log ở [${cursor},${toBlock}]`)
      newLogs.push(...chunkLogs)
    }
    cursor = toBlock + 1n
    await sleep(350)
  }

  const allLogs = dedupeLogs([...seedLogs, ...newLogs])

  const touchedBillIds = new Set()
  for (const log of allLogs) {
    if (['BillCreated', 'SharePaid', 'SlotFilled'].includes(log.eventName)) {
      touchedBillIds.add(toBig(log.args.billId).toString())
    }
  }
  console.log(`${touchedBillIds.size} bill có thay đổi cần đồng bộ`)

  const paymentsBatch = db.batch()
  let paymentsInBatch = 0

  for (const billIdStr of touchedBillIds) {
    const billIdBig = BigInt(billIdStr)
    const billRef = db.collection('bills').doc(billIdStr)
    const existingSnap = await billRef.get()
    const existing = existingSnap.exists ? existingSnap.data() : {}

    const bill = await readWithRetry('getBill', [billIdBig])
    await sleep(150)

    const createdLog = allLogs.find(
      (l) => l.eventName === 'BillCreated' && toBig(l.args.billId).toString() === billIdStr
    )

    const doc = {
      organizer: bill.organizer.toLowerCase(),
      mode: Number(bill.mode),
      totalAmount: bill.totalAmount.toString(),
      amountPerSlot: bill.amountPerSlot.toString(),
      numSlots: Number(bill.numSlots),
      matchedSlotsCount: Number(bill.matchedSlotsCount),
      extraReceived: bill.extraReceived.toString(),
      ...(createdLog
        ? { txHash: createdLog.transactionHash, blockNumber: toNum(createdLog.blockNumber) }
        : {}),
    }

    if (Number(bill.mode) === BILL_MODE_ASSIGNED) {
      const shareCountNum = Number(await readWithRetry('shareCount', [billIdBig]))
      await sleep(150)
      const sharePaidLogs = allLogs.filter(
        (l) => l.eventName === 'SharePaid' && toBig(l.args.billId).toString() === billIdStr
      )
      const existingShares = existing.shares ?? []
      const shares = []
      for (let shareId = 0; shareId < shareCountNum; shareId++) {
        const share = await readWithRetry('getShare', [billIdBig, BigInt(shareId)])
        await sleep(150)
        const newLog = sharePaidLogs.find((l) => toNum(l.args.shareId) === shareId)
        const existingEntry = existingShares.find((s) => s.shareId === shareId)
        shares.push({
          shareId,
          amount: share.amount.toString(),
          paid: share.paid,
          payer: newLog ? newLog.args.payer.toLowerCase() : existingEntry?.payer ?? null,
          txHash: newLog ? newLog.transactionHash : existingEntry?.txHash ?? null,
          blockNumber: newLog ? toNum(newLog.blockNumber) : existingEntry?.blockNumber ?? null,
        })
        if (newLog) {
          const paymentRef = db.collection('payments').doc(`${newLog.transactionHash}-${newLog.logIndex}`)
          paymentsBatch.set(paymentRef, {
            billId: billIdStr,
            shareId,
            payer: newLog.args.payer.toLowerCase(),
            amount: toBig(newLog.args.amount).toString(),
            matched: null,
            txHash: newLog.transactionHash,
            blockNumber: toNum(newLog.blockNumber),
          })
          paymentsInBatch++
        }
      }
      doc.shares = shares
    } else {
      const slotLogs = allLogs.filter(
        (l) => l.eventName === 'SlotFilled' && toBig(l.args.billId).toString() === billIdStr
      )
      const existingContributions = existing.contributions ?? []
      const existingTxHashes = new Set(existingContributions.map((c) => c.txHash))
      const newContributions = slotLogs
        .filter((l) => !existingTxHashes.has(l.transactionHash))
        .map((l) => ({
          payer: l.args.payer.toLowerCase(),
          amount: toBig(l.args.amount).toString(),
          matched: l.args.matched,
          txHash: l.transactionHash,
          blockNumber: toNum(l.blockNumber),
        }))
      doc.contributions = [...existingContributions, ...newContributions]

      for (const l of newContributions) {
        const source = slotLogs.find((s) => s.transactionHash === l.txHash)
        const paymentRef = db.collection('payments').doc(`${l.txHash}-${source.logIndex}`)
        paymentsBatch.set(paymentRef, {
          billId: billIdStr,
          shareId: null,
          payer: l.payer,
          amount: l.amount,
          matched: l.matched,
          txHash: l.txHash,
          blockNumber: l.blockNumber,
        })
        paymentsInBatch++
      }
    }

    await billRef.set(doc, { merge: true })
    console.log(`  ✓ bill ${billIdStr} (${Number(bill.mode) === BILL_MODE_ASSIGNED ? 'ASSIGNED' : 'OPEN_SLOT'})`)
  }

  if (paymentsInBatch > 0) {
    await paymentsBatch.commit()
    console.log(`Ghi ${paymentsInBatch} payment doc`)
  }

  await metaRef.set({ lastIndexedBlock: Number(latestBlock) })
  console.log('--- DONE --- lastIndexedBlock:', latestBlock.toString())
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
