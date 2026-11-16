import { useEffect, useState } from 'react'
import { getHistoricalCategories, getReportingTransactions, loadCategoryConfig } from './categoryData.js'
import PageHeader from './PageHeader'
import ClassificationReviewReport from './ClassificationReviewReport.jsx'
import IncomeVsExpensesReport from './IncomeVsExpensesReport.jsx'
import { formatMonthLabel, getMonthBounds, getMonthKey, shiftMonth } from './reportData.js'
import SpendingByCategoryReport from './SpendingByCategoryReport.jsx'
import { classifyTransactions, getSpendingEntries } from './transactionRules.js'

let monthToRestore = null

const card = {
  background: '#FFFFFF',
  padding: '8px 10px',
  borderRadius: 16,
  marginBottom: 10,
  boxShadow: '0 3px 14px #76552212'
}

const arrowButton = {
  width: 38,
  height: 38,
  border: '1px solid #E9D6B7',
  borderRadius: 10,
  background: '#FFFFFF',
  color: '#79502A',
  fontSize: 18,
  cursor: 'pointer'
}

// Add future reports (Cash Flow, Debt Progress, Spending Trends) here. Each section
// receives the same inputs and is rendered in order under the shared month selector.
const REPORT_SECTIONS = [
  { id: 'spending-by-category', Component: SpendingByCategoryReport },
  { id: 'income-vs-expenses', Component: IncomeVsExpensesReport },
  { id: 'needs-classification', Component: ClassificationReviewReport }
]

export default function Reports({ transactions, accounts = [], today, cardColor = '#FFFFFF', onBack, onEditTransaction }) {
  const currentMonth = today.slice(0, 7)
  const [month, setMonth] = useState(() => monthToRestore ?? currentMonth)
  const [expanded, setExpanded] = useState(null)
  useEffect(() => { monthToRestore = null }, [])
  const categoryConfig = loadCategoryConfig()
  const categories = getHistoricalCategories(categoryConfig)
  const categorizedTransactions = getReportingTransactions(transactions, categoryConfig)
  const bounds = getMonthBounds(transactions, currentMonth)
  const inMonth = classifyTransactions({ transactions: categorizedTransactions, categories, accounts })
    .filter(record => getMonthKey(record.date) === month)
  const breakdowns = {
    spending: getSpendingEntries(inMonth),
    income: inMonth.filter(record => record.kind === 'income').map(record => ({ transaction: record.transaction, cents: record.cents })),
    debtPayments: inMonth.filter(record => record.kind === 'debt-payment').map(record => ({ transaction: record.transaction, cents: -record.signedCents }))
  }
  const changeMonth = delta => {
    setExpanded(null)
    setMonth(shiftMonth(month, delta))
  }
  const editTransaction = request => {
    if (!onEditTransaction) return
    monthToRestore = month
    onEditTransaction(request)
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader backLabel="More" onBack={onBack}>Reports</PageHeader>

      <section role="group" aria-label="Report month" style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= bounds.first}
          onClick={() => changeMonth(-1)}
          style={{ ...arrowButton, opacity: month <= bounds.first ? 0.4 : 1, cursor: month <= bounds.first ? 'not-allowed' : 'pointer' }}
        >
          ‹
        </button>
        <strong aria-live="polite" style={{ fontSize: 15 }}>{formatMonthLabel(month)}</strong>
        <button
          type="button"
          aria-label="Next month"
          disabled={month >= bounds.last}
          onClick={() => changeMonth(1)}
          style={{ ...arrowButton, opacity: month >= bounds.last ? 0.4 : 1, cursor: month >= bounds.last ? 'not-allowed' : 'pointer' }}
        >
          ›
        </button>
      </section>

      {REPORT_SECTIONS.map(({ id, Component }) => (
        <Component
          key={id}
          transactions={categorizedTransactions}
          categories={categories}
          accounts={accounts}
          month={month}
          cardColor={cardColor}
          breakdowns={breakdowns}
          expanded={expanded}
          onToggleBreakdown={key => setExpanded(current => current === key ? null : key)}
          onEditTransaction={editTransaction}
        />
      ))}
    </main>
  )
}
