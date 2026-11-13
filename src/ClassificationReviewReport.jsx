import { FLAG_REASONS } from './transactionRules.js'
import { getReportFlags } from './reportData.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const card = {
  background: '#FFFFFF',
  padding: 14,
  borderRadius: 16,
  marginBottom: 10,
  boxShadow: '0 3px 14px #76552212'
}

// Lists transactions whose classification is a safe default rather than a certainty. They stay exactly as
// recorded; the user decides what they are by editing them under Accounts.
export default function ClassificationReviewReport({ transactions, categories, accounts, month }) {
  const flags = getReportFlags({ transactions, month, categories, accounts })
  if (flags.length === 0) return null

  const grouped = []
  for (const flag of flags) {
    const existing = grouped.find(item => item.transaction === flag.transaction)
    if (existing) existing.reasons.push(flag.reason)
    else grouped.push({ transaction: flag.transaction, reasons: [flag.reason] })
  }

  return (
    <section aria-labelledby="needs-classification-title" style={card}>
      <h2 id="needs-classification-title" style={{ margin: '0 0 6px', fontSize: 16 }}>Needs classification</h2>
      <details>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
          {grouped.length} {grouped.length === 1 ? 'transaction' : 'transactions'} may need a category or type
        </summary>
        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, fontSize: 12 }}>
          {grouped.map(({ transaction, reasons }) => (
            <li
              key={transaction.id ?? `${transaction.date}-${transaction.name}`}
              data-review-item={transaction.id}
              style={{ padding: '5px 0', borderTop: '1px solid var(--theme-border, #EADBC8)', textAlign: 'left' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {transaction.date} · {transaction.name ?? 'Transaction'}
                </span>
                <strong>{money(transaction.amount)}</strong>
              </div>
              {reasons.map(reason => (
                <div key={reason} style={{ opacity: 0.85 }}>{FLAG_REASONS[reason]}</div>
              ))}
            </li>
          ))}
        </ul>
        <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.8 }}>
          Nothing was changed. Edit a transaction under Accounts to set its category.
        </p>
      </details>
    </section>
  )
}
