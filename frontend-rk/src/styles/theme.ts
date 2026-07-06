// Token màu dùng chung cho toàn app.
// Đổi giá trị ở đây = đổi theme cho mọi trang, không phải sửa từng file.
// Quy tắc: không viết hex trực tiếp trong component nữa, chỉ import từ đây.

export const colors = {
  // Accent thương hiệu (link, border chọn, icon, chữ nhấn) — KHÔNG dùng cho nền nút chính,
  // xem buttonPrimary bên dưới. Bảng màu lavender/violet theo prototype v7.
  primary: '#7C6AEF',
  primaryHover: '#6952E0',

  // Nền nút hành động chính (Tạo bill, Approve, Trả tiền...) — than đen theo thiết kế,
  // tách riêng khỏi `primary` vì trước đây dùng chung 1 token cho cả nút lẫn accent/link.
  buttonPrimary: '#17151F',
  buttonPrimaryHover: '#2B2838',

  // Nền
  surface: '#FFFFFF',          // nền card/box
  background: '#F5F2FE',       // nền trang (lavender sáng)
  backgroundSubtle: '#EFEBFF', // nền phụ (box link, ô nhạt) — violet-bg
  selectedBg: '#EFEBFF',       // nền khi item được chọn

  // Viền
  border: '#E5E0F4',
  borderLight: '#E5E0F4',

  // Chữ
  textPrimary: '#17151F',
  textSecondary: '#6E6A80',
  textMuted: '#6E6A80',
  label: '#6E6A80',
  bodyText: '#17151F',

  // Trạng thái
  success: '#17A268',
  successBg: '#DFF5EA',
  successText: '#17A268',
  danger: '#DE4763',
  dangerBg: '#FCE7EB', // nền badge "CHƯA TRẢ" (rose-soft) — đi cùng cặp success/successBg
  warning: '#D98E12',
  warningBg: '#FBF0D8', // nền badge "ĐANG THU" (amber-soft)

  // Badge tím nhạt (mục "how it works" ở trang chủ)
  badgeBg: '#EFEBFF',
  badgeText: '#7C6AEF',

  // Màu đổ bóng nhẹ cho card — dùng trong box-shadow, KHÔNG dùng làm màu nền/chữ
  // ví dụ: boxShadow: `0 1px 2px ${colors.shadowColor}`
  shadowColor: '#6050B414',

  // Riêng cho panel "hoá đơn" xem trước (receipt) — tông ink/mut hơi khác chữ
  // thường một chút, đúng theo prototype (paper-ink/paper-mut), không dùng nơi khác
  paperInk: '#1B1926',
  paperMuted: '#8A8699',
} as const

export const radius = {
  card: 12,
  button: 8,
} as const

// Cho phép prop kiểu: color?: ColorToken khi cần giới hạn giá trị hợp lệ
export type ColorToken = keyof typeof colors
export type RadiusToken = keyof typeof radius