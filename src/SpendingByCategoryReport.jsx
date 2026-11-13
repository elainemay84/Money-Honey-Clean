import {
  formatMonthLabel,
  getChartColors,
  getDoughnutSegments,
  getSpendingByCategory
} from './reportData.js'

const RADIUS = 44
const STROKE = 15

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const card = {
  background: '#FFFFFF',
  padding: 14,
  borderRadius: 16,
  marginBottom: 10,
  boxShadow: '0 3px 14px #76552212'
}

function formatPercent(item) {
  return item.percent === 0 ? '<1%' : `${item.percent}%`
}

export default function SpendingByCategoryReport({ transactions, categories, month, cardColor }) {
  const report = getSpendingByCategory({ transactions, month, categories })
  const label = formatMonthLabel(month)
  const colors = getChartColors(report.items, cardColor)
  const segments = getDoughnutSegments(report.items, RADIUS)
  const totalText = money(report.total)

  return (
    <section aria-labelledby="spending-by-category-title" style={card}>
      <h2 id="spending-by-category-title" style={{ margin: '0 0 8px', fontSize: 16 }}>Spending by Category</h2>

      {report.items.length === 0 ? (
        <p style={{ margin: '6px 0 4px', textAlign: 'center', color: '#79502A', fontSize: 13 }}>
          No spending recorded for {label}.
        </p>
      ) : (
        <>
          <div style={{ position: 'relative', width: 'min(100%, 156px)', aspectRatio: '1', margin: '0 auto 8px' }}>
            <svg
              viewBox="0 0 120 120"
              role="img"
              aria-label={`Spending by category for ${label}: ${totalText} total across ${report.items.length} ${report.items.length === 1 ? 'category' : 'categories'}`}
              style={{ display: 'block', width: '100%', height: '100%', transform: 'rotate(-90deg)' }}
            >
              {segments.map((segment, index) => (
                <circle
                  key={segment.category}
                  data-report-slice={segment.category}
                  cx="60"
                  cy="60"
                  r={RADIUS}
                  fill="none"
                  stroke={colors[index]}
                  strokeWidth={STROKE}
                  strokeDasharray={`${segment.dash} ${segment.rest}`}
                  strokeDashoffset={segment.offset}
                />
              ))}
            </svg>
            <div style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              pointerEvents: 'none'
            }}>
              <span style={{ fontSize: 11, opacity: 0.8 }}>Total spent</span>
              <strong style={{ fontSize: totalText.length > 9 ? 14 : 17, lineHeight: 1.2 }}>{totalText}</strong>
            </div>
          </div>

          <ul style={{ listStyle: 'none', margin: 0, padding: 0, fontSize: 13 }}>
            {report.items.map((item, index) => (
              <li
                key={item.category}
                data-report-row={item.category}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: '1px solid var(--theme-border, #EADBC8)' }}
              >
                <span
                  aria-hidden="true"
                  data-report-swatch={item.category}
                  style={{ flex: '0 0 10px', width: 10, height: 10, borderRadius: '50%', background: colors[index] }}
                />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textAlign: 'left', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.isGroup ? `${item.category} (${item.count})` : item.category}
                </span>
                <strong>{money(item.amount)}</strong>
                <span style={{ flex: '0 0 36px', textAlign: 'right', fontSize: 12 }}>{formatPercent(item)}</span>
              </li>
            ))}
          </ul>

          {report.refundTotal > 0 && (
            <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.8 }}>
              {money(report.refundTotal)} in refunds this month are not subtracted, matching Budgets.
            </p>
          )}
        </>
      )}
    </section>
  )
}
