export default function PageHeader({ backLabel, onBack, children, action = null, className = '' }) {
  return (
    <div className={`page-header ${className}`.trim()}>
      <button type="button" className="page-back" onClick={onBack}>
        ‹ {backLabel}
      </button>
      <h1>{children}</h1>
      <div className="page-header-action">{action}</div>
    </div>
  )
}
