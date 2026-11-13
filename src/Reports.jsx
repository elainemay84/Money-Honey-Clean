import { useState } from 'react'
import { getCategories, loadCategoryConfig } from './categoryData.js'
import PageHeader from './PageHeader'
import ClassificationReviewReport from './ClassificationReviewReport.jsx'
import IncomeVsExpensesReport from './IncomeVsExpensesReport.jsx'
import { formatMonthLabel, getMonthBounds, shiftMonth } from './reportData.js'
import SpendingByCategoryReport from './SpendingByCategoryReport.jsx'

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
  const [month, setMonth] = useState(currentMonth)
  const { customCategories, builtInNames, disabledBuiltIns } = loadCategoryConfig()
  const categories = getCategories(customCategories, 'expense', builtInNames, disabledBuiltIns)
  const bounds = getMonthBounds(transactions, currentMonth)

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader backLabel="More" onBack={onBack}>Reports</PageHeader>

      <section role="group" aria-label="Report month" style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          type="button"
          aria-label="Previous month"
          disabled={month <= bounds.first}
          onClick={() => setMonth(shiftMonth(month, -1))}
          style={{ ...arrowButton, opacity: month <= bounds.first ? 0.4 : 1, cursor: month <= bounds.first ? 'not-allowed' : 'pointer' }}
        >
          ‹
        </button>
        <strong aria-live="polite" style={{ fontSize: 15 }}>{formatMonthLabel(month)}</strong>
        <button
          type="button"
          aria-label="Next month"
          disabled={month >= bounds.last}
          onClick={() => setMonth(shiftMonth(month, 1))}
          style={{ ...arrowButton, opacity: month >= bounds.last ? 0.4 : 1, cursor: month >= bounds.last ? 'not-allowed' : 'pointer' }}
        >
          ›
        </button>
      </section>

      {REPORT_SECTIONS.map(({ id, Component }) => (
        <Component
          key={id}
          transactions={transactions}
          categories={categories}
          accounts={accounts}
          month={month}
          cardColor={cardColor}
onEditTransaction={onEditTransaction}
        />
      ))}
    </main>
  )
}
