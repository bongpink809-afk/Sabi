import { useId } from 'react'

// Logo gốc từ gemini-svg.svg — mỗi instance phải có id gradient riêng
// (useId), vì id trùng nhau nhiều lần trên cùng 1 trang khiến trình duyệt
// render sai gradient (lỗi thật đã gặp khi dựng prototype tĩnh bằng id cố định).
export function SabiLogo({ size = 34 }: { size?: number }) {
  const uid = useId()
  const bgId = `sabi-logo-bg-${uid}`
  const sId = `sabi-logo-s-${uid}`

  return (
    <svg viewBox="0 0 500 500" width={size} height={size} style={{ borderRadius: '22%', flexShrink: 0 }}>
      <defs>
        <linearGradient id={bgId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#021128" />
          <stop offset="70%" stopColor="#0b284c" />
          <stop offset="100%" stopColor="#214b75" />
        </linearGradient>
        <linearGradient id={sId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="30%" stopColor="#e2eaf4" />
          <stop offset="70%" stopColor="#b6c7db" />
          <stop offset="100%" stopColor="#93a9c2" />
        </linearGradient>
      </defs>
      <rect width="500" height="500" rx="110" fill={`url(#${bgId})`} />
      <path
        d="M 375,170 C 375,115 320,105 250,105 C 160,105 130,150 130,200
           C 130,245 165,265 220,280 L 290,300 C 340,315 365,335 365,375
           C 365,420 325,445 250,445 C 170,445 125,415 125,365 L 185,365
           C 185,395 210,405 250,405 C 295,405 315,390 315,370 C 315,345
           295,335 250,322 L 180,302 C 130,288 85,255 85,195 C 85,130
           140,65 250,65 C 340,65 425,100 425,170 Z"
        fill={`url(#${sId})`}
      />
    </svg>
  )
}
