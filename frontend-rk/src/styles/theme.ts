// Token màu dùng chung cho toàn app.
// Đổi giá trị ở đây = đổi theme cho mọi trang, không phải sửa từng file.
// Quy tắc: không viết hex trực tiếp trong component nữa, chỉ import từ đây.

export const colors = {
  // Thương hiệu / hành động chính (nút, link, logo)
  primary: '#4f46e5',
  primaryHover: '#4338ca',

  // Nền
  surface: '#ffffff',          // nền card/box
  background: '#fafafa',       // nền trang
  backgroundSubtle: '#f8fafc', // nền phụ (box link, ô nhạt)
  selectedBg: '#faf5ff',       // nền khi item được chọn

  // Viền
  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  // Chữ
  textPrimary: '#0f172a',
  textSecondary: '#64748b',
  textMuted: '#94a3b8',
  label: '#374151',
  bodyText: '#334155',

  // Trạng thái
  success: '#16a34a',
  successBg: '#f0fdf4',
  successText: '#166534',
  danger: '#ef4444',
  warning: '#f59e0b',

  // Badge tím nhạt (mục "how it works" ở trang chủ)
  badgeBg: '#ede9fe',
  badgeText: '#6d28d9',

  // Màu đổ bóng nhẹ cho card — dùng trong box-shadow, KHÔNG dùng làm màu nền/chữ
  // ví dụ: boxShadow: `0 1px 2px ${colors.shadowColor}`
  shadowColor: '#0001',
} as const

export const radius = {
  card: 12,
  button: 8,
} as const

// Cho phép prop kiểu: color?: ColorToken khi cần giới hạn giá trị hợp lệ
export type ColorToken = keyof typeof colors
export type RadiusToken = keyof typeof radius