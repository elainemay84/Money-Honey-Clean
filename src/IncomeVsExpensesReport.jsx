import {
  formatMonthLabel,
  getBarShares,
  getIncomeExpenseColors,
  getIncomeVsExpenses
} from './reportData.js'
import ReportBreakdown, { BreakdownButton, BreakdownChevron } from './ReportBreakdown.jsx'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const card = {
  background: '#FFFFFF',
  padding: 14,
  borderRadius: 16,
  marginBottom: 10,
  boxShadow: '0 3px 14px #76552212'
}

function netSummary(net) {
  if (net > 0) return `Income exceeded expenses by ${money(net)}.`
  if (net < 0) return `Expenses exceeded income by ${money(Math.abs(net))}.`
  return 'Income and expenses were equal.'
}

function BarRow({ label, amount, share, color, entries, expanded, onToggle, onEditTransaction, unmatchedRefundTotal }) {
  return (
    <div data-report-bar={label} style={{ marginBottom: 8 }}>
      <BreakdownButton aria-expanded={expanded} onClick={onToggle} style={{ fontSize: 13, padding: '3px 0' }}>
        <span style={{ flex: 1 }}>{label}</span>
        <strong>{money(amount)}</strong>
        <BreakdownChevron expanded={expanded} />
      </BreakdownButton>
      <div style={{ height: 12, borderRadius: 6, background: 'var(--theme-border, #EADBC8)', overflow: 'hidden' }}>
        <div
          data-report-bar-fill={label}
          style={{ width: `${(share * 100).toFixed(2)}%`, height: '100%', borderRadius: 6, background: color }}
        />
      </div>
      {expanded && <ReportBreakdown entries={entries} subtotal={amount} unmatchedRefundTotal={unmatchedRefundTotal} onEditTransaction={onEditTransaction} />}
    </div>
  )
}

export default function IncomeVsExpensesReport({ transactions, categories, accounts, month, cardColor, breakdowns, expanded, onToggleBreakdown, onEditTransaction }) {
  const report = getIncomeVsExpenses({ transactions, month, categories, accounts })
  const label = formatMonthLabel(month)
  const colors = getIncomeExpenseColors(cardColor)
  const shares = getBarShares(report.income, report.expenses)

  return (
    <section aria-labelledby="income-vs-expenses-title" style={card}>
      <h2 id="income-vs-expenses-title" style={{ margin: '0 0 8px', fontSize: 16 }}>Income vs. Expenses</h2>

      {!report.hasActivity ? (
        <p style={{ margin: '6px 0 4px', textAlign: 'center', color: '#79502A', fontSize: 13 }}>
          No income or expenses recorded for {label}.
        </p>
      ) : (
        <>
          <div role="group" aria-label={`Income ${money(report.income)} compared with expenses ${money(report.expenses)} for ${label}`}>
            <BarRow label="Income" amount={report.income} share={shares.income} color={colors.income} entries={breakdowns.income} expanded={expanded === 'income'} onToggle={() => onToggleBreakdown('income')} onEditTransaction={onEditTransaction} />
            <BarRow label="Expenses" amount={report.expenses} share={shares.expenses} color={colors.expenses} entries={breakdowns.spending} expanded={expanded === 'expenses'} onToggle={() => onToggleBreakdown('expenses')} onEditTransaction={onEditTransaction} unmatchedRefundTotal={report.unmatchedRefundTotal} />
          </div>

          <div style={{ fontSize: 13, borderTop: '1px solid var(--theme-border, #EADBC8)' }}>
            <BreakdownButton aria-expanded={expanded === 'debt'} onClick={() => onToggleBreakdown('debt')}>
              <span style={{ flex: 1 }}>Debt Payments</span>
              <strong>{money(report.debtPayments)}</strong>
              <BreakdownChevron expanded={expanded === 'debt'} />
            </BreakdownButton>
            {expanded === 'debt' && <ReportBreakdown entries={breakdowns.debtPayments} subtotal={report.debtPayments} onEditTransaction={onEditTransaction} />}
          </div>
          <div
            data-report-net
            style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', padding: '6px 0 0', borderTop: '1px solid var(--theme-border, #EADBC8)' }}
          >
            <span style={{ fontSize: 13 }}>Net cash flow</span>
            <strong style={{ fontSize: 17 }}>{report.net > 0 ? '+' : ''}{money(report.net)}</strong>
          </div>
          <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.85, textAlign: 'right' }}>{netSummary(report.net)}</p>

          <p style={{ margin: '8px 0 0', fontSize: 11, opacity: 0.8 }}>
            Recorded transactions only. Transfers are excluded.
            {report.refundTotal > 0 && ` Expenses are net of ${money(report.refundTotal)} in refunds.`}
            {report.debtPayments !== 0 && ` Debt payments (${money(report.debtPayments)}) are not counted as expenses.`}
          </p>
        </>
      )}
    </section>
  )
}
