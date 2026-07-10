import { ReactNode } from 'react'
import { colors, radius } from '../styles/theme'

// Overlay + card dùng chung cho mọi modal — codebase trước đây chưa có
// component modal nào, mỗi nơi tự làm panel inline.
export function Modal({
  children,
  onClose,
  closeOnBackdrop = true,
  maxWidth = 420,
  cardRadius = radius.card,
}: {
  children: ReactNode
  onClose?: () => void
  closeOnBackdrop?: boolean
  maxWidth?: number
  cardRadius?: number
}) {
  return (
    <div
      onClick={closeOnBackdrop && onClose ? onClose : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(23, 21, 31, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: colors.surface,
          borderRadius: cardRadius,
          padding: 24,
          width: '100%',
          maxWidth,
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: `0 8px 32px ${colors.shadowColor}`,
        }}
      >
        {children}
      </div>
    </div>
  )
}
