import { colors, radius } from '../styles/theme'

// Microinteraction "vẽ ra khi hover/được chọn" — copy đúng logic CSS gốc từ
// sabi-ui-prototype-v8.html (.ni-line/.ni-dot/.os-block trigger cả :hover lẫn .selected).
interface ModeCardProps {
  mode: 'assigned' | 'openslot'
  tag: string
  title: string
  description: string
  selected: boolean
  onClick: () => void
}

export function ModeCard({ mode, tag, title, description, selected, onClick }: ModeCardProps) {
  return (
    <div
      className={`mode-card${selected ? ' selected' : ''}`}
      onClick={onClick}
      style={
        {
          '--violet': colors.primary,
          '--mut': colors.textSecondary,
          '--violet-bg': colors.selectedBg,
        } as React.CSSProperties
      }
    >
      <div className="mode-icon-row">
        {mode === 'assigned' ? (
          <svg className="mode-icon" viewBox="0 0 40 30" width="34" height="26" fill="none">
            <circle className="ni-dot" cx="5" cy="6" r="2.4" />
            <line className="ni-line" x1="12" y1="6" x2="34" y2="6" />
            <circle className="ni-dot" cx="5" cy="15" r="2.4" />
            <line className="ni-line" x1="12" y1="15" x2="30" y2="15" />
            <circle className="ni-dot" cx="5" cy="24" r="2.4" />
            <line className="ni-line" x1="12" y1="24" x2="26" y2="24" />
          </svg>
        ) : (
          <svg className="mode-icon" viewBox="0 0 40 30" width="34" height="26" fill="none">
            <rect className="os-block os-b1" x="16.5" y="11.5" width="7" height="7" rx="1.5" />
            <rect className="os-block os-b2" x="16.5" y="11.5" width="7" height="7" rx="1.5" />
            <rect className="os-block os-b3" x="16.5" y="11.5" width="7" height="7" rx="1.5" />
            <rect className="os-block os-b4" x="16.5" y="11.5" width="7" height="7" rx="1.5" />
          </svg>
        )}
        <span className="mode-tag">{tag}</span>
      </div>
      <h3>{title}</h3>
      <p>{description}</p>

      <style jsx>{`
        .mode-card {
          border: 1.5px solid ${colors.border};
          border-radius: ${radius.card}px;
          background: ${colors.surface};
          padding: 16px;
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
          flex: 1 1 0;
          min-width: 0;
          box-sizing: border-box;
        }
        .mode-card:hover {
          border-color: var(--mut);
          transform: translateY(-2px);
          box-shadow: 0 10px 26px rgba(96, 80, 180, 0.1);
        }
        .mode-card.selected {
          border-color: var(--violet);
          background: linear-gradient(180deg, var(--violet-bg), ${colors.surface});
          box-shadow: 0 10px 30px rgba(124, 106, 239, 0.18);
        }
        .mode-card.selected::after {
          content: '✓';
          position: absolute;
          top: 12px;
          right: 14px;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          background: var(--violet);
          color: #fff;
          display: grid;
          place-items: center;
          font-size: 12px;
          font-weight: 700;
          animation: popIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes popIn {
          from {
            transform: scale(0);
          }
          to {
            transform: scale(1);
          }
        }
        .mode-card h3 {
          font-size: 16px;
          font-weight: 600;
          margin: 0 0 6px;
          color: ${colors.textPrimary};
        }
        .mode-card p {
          font-size: 12.5px;
          color: var(--mut);
          line-height: 1.55;
          margin: 0;
        }
        .mode-tag {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10.5px;
          color: var(--violet);
          letter-spacing: 0.06em;
        }
        .mode-icon-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 8px;
        }
        .mode-icon {
          overflow: visible;
          flex-shrink: 0;
        }
        .ni-line {
          stroke: var(--mut);
          stroke-width: 3;
          stroke-linecap: round;
          stroke-dasharray: 24;
          stroke-dashoffset: 24;
          transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;
        }
        .ni-dot {
          fill: var(--mut);
          opacity: 0.35;
          transform-origin: center;
          transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), fill 0.3s ease;
        }
        .mode-card:hover .ni-line,
        .mode-card.selected .ni-line {
          stroke-dashoffset: 0;
          stroke: var(--violet);
        }
        .mode-card:hover .ni-dot,
        .mode-card.selected .ni-dot {
          opacity: 1;
          fill: var(--violet);
          transform: scale(1.15);
        }
        .ni-line:nth-of-type(2),
        .ni-dot:nth-of-type(2) {
          transition-delay: 0.08s;
        }
        .ni-line:nth-of-type(3),
        .ni-dot:nth-of-type(3) {
          transition-delay: 0.16s;
        }
        .os-block {
          fill: var(--mut);
          opacity: 0.5;
          transition: transform 0.4s cubic-bezier(0.34, 1.2, 0.4, 1), opacity 0.3s ease, fill 0.3s ease;
          transform-origin: center;
        }
        .mode-card:hover .os-block,
        .mode-card.selected .os-block {
          opacity: 1;
          fill: var(--violet);
        }
        .mode-card:hover .os-b1,
        .mode-card.selected .os-b1 {
          transform: translate(-13px, -8px);
        }
        .mode-card:hover .os-b2,
        .mode-card.selected .os-b2 {
          transform: translate(13px, -8px);
          transition-delay: 0.02s;
        }
        .mode-card:hover .os-b3,
        .mode-card.selected .os-b3 {
          transform: translate(-13px, 8px);
          transition-delay: 0.04s;
        }
        .mode-card:hover .os-b4,
        .mode-card.selected .os-b4 {
          transform: translate(13px, 8px);
          transition-delay: 0.06s;
        }
      `}</style>
    </div>
  )
}
