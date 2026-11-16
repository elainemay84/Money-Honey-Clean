const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const breakdownButtonStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 0',
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer'
}

export function BreakdownButton({ children, style, ...props }) {
  return <button type="button" {...props} style={{ ...breakdownButtonStyle, ...style }}>{children}</button>
}

export function BreakdownChevron({ expanded }) {
  return <span aria-hidden="true" style={{ fontSize: 12, opacity: 0.7 }}>{expanded ? '▴' : '▾'}</span>
}

export default function ReportBreakdown({ entries, subtotal, unmatchedRefundTotal = 0, onEditTransaction }) {
  const sorted = [...entries].sort((a, b) => String(b.transaction.date).localeCompare(String(a.transaction.date)))

  return (
    <div style={{ padding: '0 0 6px 12px', fontSize: 12 }}>
      {sorted.length === 0 ? (
        <p style={{ margin: '4px 0', opacity: 0.8 }}>No transactions.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {sorted.map(({ transaction, cents }) => (
            <li key={transaction.id} style={{ borderTop: '1px solid var(--theme-border, #EADBC8)' }}>
              <button
                type="button"
                data-breakdown-transaction={transaction.id}
                onClick={() => onEditTransaction?.({ transactionId: transaction.id, accountId: transaction.accountId })}
                style={{ ...breakdownButtonStyle, justifyContent: 'space-between' }}
              >
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                  <span style={{ display: 'block' }}>{transaction.name || 'Transaction'}</span>
                  <span style={{ opacity: 0.75 }}>{transaction.date} · {transaction.category || 'Uncategorized'} · {transaction.cleared ? 'Cleared' : 'Uncleared'}</span>
                </span>
                <strong style={{ flexShrink: 0 }}>{money(cents / 100)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
      {unmatchedRefundTotal > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', opacity: 0.8 }}>
          <span>Unmatched refunds excluded</span>
          <span>+{money(unmatchedRefundTotal)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderTop: '1px solid var(--theme-border, #EADBC8)' }}>
        <span>Subtotal</span>
        <strong>{money(subtotal)}</strong>
      </div>
    </div>
  )
}
