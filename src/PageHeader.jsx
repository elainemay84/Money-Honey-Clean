import ResponsiveText from './ResponsiveText'

export default function PageHeader({ backLabel, onBack, children, action = null, className = '', showBack = true }) {
  return (
    <div className={`page-header ${className}`.trim()}>
      {showBack ? (
        <button type="button" className="page-back" onClick={onBack}>
          ‹ {backLabel}
        </button>
      ) : null}
      <ResponsiveText>{children}</ResponsiveText>
      {action ? <div className="page-header-action">{action}</div> : null}
    </div>
  )
}
