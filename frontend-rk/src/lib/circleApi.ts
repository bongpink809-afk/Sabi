// src/lib/circleApi.ts
// ─── Client dùng chung để gọi Circle User-Controlled Wallets REST API ─────
// CHỈ được import từ code chạy server-side (pages/api/circle/*) — CIRCLE_API_KEY
// không bao giờ được đọc/trả về từ code client.

const CIRCLE_API_BASE = 'https://api.circle.com'

export class CircleApiError extends Error {
  constructor(public status: number, public code: number | undefined, message: string) {
    super(message)
  }
}

/**
 * Gọi 1 endpoint REST của Circle. Tự gắn header Authorization (API key server-only)
 * + X-User-Token nếu có userToken (bắt buộc cho mọi call gắn với 1 user cụ thể).
 */
export async function circleFetch<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; userToken?: string } = {}
): Promise<T> {
  const apiKey = process.env.CIRCLE_API_KEY
  if (!apiKey) throw new Error('CIRCLE_API_KEY chưa được cấu hình (server env)')

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (options.userToken) headers['X-User-Token'] = options.userToken

  const res = await fetch(`${CIRCLE_API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })

  const json = await res.json().catch(() => undefined)

  if (!res.ok) {
    const code = json?.code as number | undefined
    const message = json?.message ?? `Circle API lỗi (${res.status})`
    throw new CircleApiError(res.status, code, message)
  }

  return json.data as T
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

// Mã lỗi Circle dùng chung nhiều nơi — xem ErrorCode enum trong @circle-fin/w3s-pw-web-sdk
export const CIRCLE_ERROR_USER_WAS_INITIALIZED = 155106
