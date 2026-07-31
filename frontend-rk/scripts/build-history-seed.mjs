// Quét TOÀN BỘ lịch sử 3 event (BillCreated, SharePaid, SlotFilled) từ block deploy
// SabiBill tới block hiện tại, đóng gói thành 1 file JSON tĩnh (public/data/onchain-history-seed.json)
// dùng làm "nền" lịch sử cũ cho eventScan.ts — vì RPC public (rpc.testnet.arc.network) giới hạn
// eth_getLogs tối đa 10.000 block/lần VÀ có rate-limit riêng (đã verify thật, không đoán:
// lỗi -32011 "request limit reached" / -32005 "rate limit exceeded" khi dồn request quá nhanh),
// nên quét full ~4,27 triệu block trong 1 lần tải trang là không khả thi cho từng user.
//
// Chạy 1 lần (không cần định kỳ) — sau khi có file này, eventScan.ts chỉ cần catch-up từ
// cutoffBlock trở đi, y hệt cơ chế catch-up đang có.
//
// Cách chạy: node scripts/build-history-seed.mjs   (chạy trong thư mục frontend-rk)
// Có checkpoint — Ctrl+C giữa chừng rồi chạy lại sẽ tiếp tục từ chỗ dở dang, không quét lại từ đầu.

import { createPublicClient, http } from 'viem'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RPC_URL = 'https://rpc.testnet.arc.network'
const ADDRESS = '0x192963eBcC9f39C0057597CF3AA7d97c99a83c75'
const DEPLOY_BLOCK = 50295105n
const CHUNK = 10000n

const EVENTS_ABI = [
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
]

const client = createPublicClient({ transport: http(RPC_URL) })

const CHECKPOINT_PATH = path.join(__dirname, '.seed-checkpoint.json')
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'data')
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'onchain-history-seed.json')

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function serializeLog(eventName, log) {
  const args = {}
  for (const [k, v] of Object.entries(log.args)) {
    args[k] = typeof v === 'bigint' ? v.toString() : v
  }
  return {
    eventName,
    args,
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber.toString(),
    logIndex: log.logIndex,
  }
}

async function scanChunk(fromBlock, toBlock) {
  let attempt = 0
  for (;;) {
    attempt++
    try {
      const logs = await client.getContractEvents({
        address: ADDRESS,
        abi: EVENTS_ABI,
        fromBlock,
        toBlock,
      })
      return logs.map((l) => serializeLog(l.eventName, l))
    } catch (e) {
      const wait = Math.min(2000 * attempt, 30000)
      console.log(`  [retry ${attempt}] range [${fromBlock},${toBlock}]: ${e.shortMessage || e.message} — chờ ${wait}ms`)
      await sleep(wait)
    }
  }
}

function loadCheckpoint() {
  if (!existsSync(CHECKPOINT_PATH)) return null
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8'))
  } catch {
    return null
  }
}

function saveCheckpoint(nextFromBlock, logs) {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify({ nextFromBlock: nextFromBlock.toString(), logs }))
}

async function main() {
  const latestBlock = await client.getBlockNumber()
  console.log('latest block:', latestBlock.toString(), 'deploy block:', DEPLOY_BLOCK.toString())

  const checkpoint = loadCheckpoint()
  let fromBlock = checkpoint ? BigInt(checkpoint.nextFromBlock) : DEPLOY_BLOCK
  let logs = checkpoint ? checkpoint.logs : []
  if (checkpoint) console.log(`resume từ checkpoint: block ${fromBlock}, đã có ${logs.length} log`)

  const totalChunks = Math.ceil(Number(latestBlock - fromBlock) / Number(CHUNK))
  let done = 0

  while (fromBlock <= latestBlock) {
    const toBlock = fromBlock + CHUNK - 1n > latestBlock ? latestBlock : fromBlock + CHUNK - 1n
    const chunkLogs = await scanChunk(fromBlock, toBlock)
    if (chunkLogs.length > 0) {
      console.log(`  +${chunkLogs.length} log ở [${fromBlock},${toBlock}]`)
      logs.push(...chunkLogs)
    }
    fromBlock = toBlock + 1n
    done++
    saveCheckpoint(fromBlock, logs)
    if (done % 20 === 0) console.log(`progress: ${done}/${totalChunks} chunk, tổng ${logs.length} log`)
    await sleep(350)
  }

  mkdirSync(OUTPUT_DIR, { recursive: true })
  writeFileSync(
    OUTPUT_PATH,
    JSON.stringify({ cutoffBlock: latestBlock.toString(), scannedAt: new Date().toISOString(), logs })
  )
  console.log('--- DONE ---')
  console.log('tổng số log:', logs.length)
  console.log('ghi ra:', OUTPUT_PATH)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(1)
})
