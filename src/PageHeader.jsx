export default function PageHeader({ backLabel, onBack, children, action = null, className = '', showBack = true }) {
  return (
    <div className={`page-header ${className}`.trim()}>
      {showBack ? (
        <button type="button" className="page-back" onClick={onBack}>
          ‹ {backLabel}
        </button>
      ) : <span className="page-back page-back-placeholder" aria-hidden="true" />}
      <h1>{children}</h1>
      <div className="page-header-action">{action}</div>
    </div>
  )
}
