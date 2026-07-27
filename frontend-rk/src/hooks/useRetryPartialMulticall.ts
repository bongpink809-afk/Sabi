import { useEffect, useRef } from 'react'

// useReadContracts mặc định allowFailure: true — nếu 1 phần tử trong multicall
// bị lỗi (vd 429 rate-limit), react-query coi cả query là THÀNH CÔNG (chỉ 1
// phần tử có status !== 'success'), nên retry/retryDelay ở query options
// không bao giờ kích hoạt. Hook này tự phát hiện phần tử lỗi và chủ động gọi
// lại refetch() với backoff, tối đa maxAttempts lần rồi thôi (tránh loop mãi
// nếu phần tử đó lỗi thật ở tầng contract, không phải do rate-limit).
export function useRetryOnPartialFailure(
  results: { status: string }[] | undefined,
  refetch: () => void,
  maxAttempts = 5
) {
  const attemptRef = useRef(0)

  useEffect(() => {
    if (!results) return
    const hasFailure = results.some((r) => r.status !== 'success')
    if (!hasFailure) {
      attemptRef.current = 0
      return
    }
    if (attemptRef.current >= maxAttempts) return
    attemptRef.current += 1
    const delay = Math.min(800 * 2 ** attemptRef.current, 10000)
    const timer = setTimeout(refetch, delay)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results])
}
