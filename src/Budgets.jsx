import { useState } from 'react'
import { getCategories, loadCategoryConfig } from './categoryData.js'
import {
  analyzeSmartBudgets,
  getBudgetEligibleTransactions,
  getBudgetSpendingByCategory,
  loadBudgetSettings,
  loadBudgets,
  loadDismissedSmartSuggestions,
  saveBudgetSettings,
  saveBudgets,
  saveDismissedSmartSuggestion
} from './budgetData.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

const card = {
  background: '#FFFFFF',
  padding: 14,
  borderRadius: 16,
  marginBottom: 10,
  boxShadow: '0 3px 14px #76552212'
}

const button = {
  padding: 9,
  borderRadius: 9,
  border: '1px solid #E9D6B7',
  background: '#FFFFFF',
  color: '#79502A',
  cursor: 'pointer'
}

export default function Budgets({ transactions, today, onBack }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [budgetSettings, setBudgetSettings] = useState(() => loadBudgetSettings())
  const [draftBudgetSettings, setDraftBudgetSettings] = useState(null)
  const [showOtherCategories, setShowOtherCategories] = useState(false)
  const [notice, setNotice] = useState('')
  const [editingBudget, setEditingBudget] = useState(null)
  const [budgetAmount, setBudgetAmount] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const { customCategories, builtInNames, disabledBuiltIns } = loadCategoryConfig()
  const mode = budgetSettings.mode
  const budgets = loadBudgets(mode)
  const categories = getCategories(customCategories, 'expense', builtInNames, disabledBuiltIns)
  const currentSpending = getBudgetSpendingByCategory({ transactions, today, categories })
  const smartAnalysis = mode === 'smart'
    ? analyzeSmartBudgets({ transactions, today, categories, historyMonths: budgetSettings.historyMonths })
    : null
  const smartDetails = new Map(smartAnalysis?.categories.map(item => [item.category, item]) ?? [])
  const dismissedSuggestions = mode === 'smart' ? loadDismissedSmartSuggestions() : {}
  const eligibleTransactions = getBudgetEligibleTransactions({ transactions, categories })
  const spending = categories.map(category => {
    const expenses = eligibleTransactions.filter(transaction => transaction.category === category)
    const smartDetail = smartDetails.get(category)
    const allMonths = [...new Set(expenses.map(transaction => transaction.date.slice(0, 7)))].sort()
    const months = mode === 'smart'
      ? allMonths.slice(-budgetSettings.historyMonths)
      : allMonths
    const historicalExpenses = expenses.filter(transaction => months.includes(transaction.date.slice(0, 7)))
    const total = historicalExpenses.reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0)
    return {
      category,
      average: smartDetail?.average ?? (months.length ? total / months.length : 0),
      spending: currentSpending[category] ?? 0,
      budget: Number.isFinite(Number(budgets[category])) ? Number(budgets[category]) : null,
      hasSpending: expenses.length > 0,
      hasEnoughHistory: smartDetail?.hasEnoughHistory ?? months.length >= 2,
      suggestedBudget: smartDetail?.suggestedBudget ?? (months.length >= 2 ? total / months.length : null),
      suggestionSignature: smartDetail?.signature
    }
  })
  const configured = spending.filter(item => item.budget != null)
  const suggestionItems = mode === 'smart' && budgetSettings.suggestionsEnabled
    ? spending.filter(item =>
      item.budget == null
      && item.hasEnoughHistory
      && dismissedSuggestions[item.category] !== item.suggestionSignature
    )
    : []
  const suggestionCategories = new Set(suggestionItems.map(item => item.category))
  const other = spending.filter(item => item.budget == null && !suggestionCategories.has(item.category))
  const configuredTotal = configured.reduce((sum, item) => sum + item.budget, 0)
  const actualTotal = spending
    .reduce((sum, item) => sum + item.spending, 0)

  function updateBudgetSetting(key, value) {
    setDraftBudgetSettings(current => ({ ...current, [key]: value }))
  }

  function openBudgetSettings() {
    setDraftBudgetSettings({ ...budgetSettings })
    setIsSettingsOpen(true)
  }

  function closeBudgetSettings() {
    setDraftBudgetSettings(null)
    setIsSettingsOpen(false)
  }

  function saveSettings() {
    const saved = saveBudgetSettings(draftBudgetSettings)
    setBudgetSettings(saved)
    setDraftBudgetSettings(null)
    setIsSettingsOpen(false)
  }

  function openBudgetEditor(item) {
    setEditingBudget(item.category)
    setBudgetAmount(item.budget == null
      ? mode === 'smart' && item.suggestedBudget != null ? String(item.suggestedBudget.toFixed(2)) : ''
      : String(item.budget))
    setNotice('')
  }

  function saveBudget() {
    const amount = Number(budgetAmount)
    if (!Number.isFinite(amount) || amount < 0) return
    saveBudgets({ ...budgets, [editingBudget]: amount }, mode)
    setEditingBudget(null)
    setNotice('')
  }

  function deleteBudget() {
    const nextBudgets = { ...budgets }
    delete nextBudgets[editingBudget]
    saveBudgets(nextBudgets, mode)
    setEditingBudget(null)
  }

  function acceptSuggestion(item) {
    saveBudgets({ ...budgets, [item.category]: item.suggestedBudget }, 'smart')
    setNotice(`${item.category} Smart Budget approved.`)
  }

  function dismissSuggestion(item) {
    saveDismissedSmartSuggestion(item.category, item.suggestionSignature)
    setNotice(`${item.category} suggestion dismissed.`)
  }

  function renderRow(item) {
    const percentage = item.budget > 0 ? (item.spending / item.budget) * 100 : item.spending > 0 ? Infinity : 0
    const progress = Math.min(100, percentage)
    const percentageLabel = Number.isFinite(percentage) ? `${percentage.toFixed(0)}% used` : 'Over 100% used'
    const budgetLabel = mode === 'smart'
      ? item.budget == null
        ? item.hasEnoughHistory ? `Suggested ${money(item.suggestedBudget)}` : 'Not enough spending history'
        : money(item.budget)
      : item.budget == null ? 'Not set' : money(item.budget)
    return (
      <button
        key={item.category}
        type="button"
        onClick={() => openBudgetEditor(item)}
        style={{
          display: 'block',
          width: '100%',
          padding: '9px 0',
          border: 'none',
          borderBottom: '1px solid #EEE5D9',
          background: 'transparent',
          color: '#493320',
          textAlign: 'left',
          cursor: 'pointer'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
          <strong style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item.category}</strong>
          <span style={{ color: '#79502A', fontSize: 12, textAlign: 'right' }}>
            {mode === 'smart' && item.budget == null
              ? item.hasEnoughHistory
                ? <span>Typical {money(item.average)} · Suggested {money(item.suggestedBudget)}</span>
                : <span>{budgetLabel}</span>
              : `${money(item.spending)} / ${budgetLabel}`}
          </span>
        </div>
        {item.budget != null && (
          <>
            <div role="progressbar" aria-label={`${item.category} budget progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number.isFinite(percentage) ? percentage : 100} style={{
              height: 5, marginTop: 6, overflow: 'hidden', borderRadius: 999, background: '#F1EEE9'
            }}>
              <div style={{ width: `${progress}%`, height: '100%', borderRadius: 999, background: percentage > 100 ? '#9B463E' : '#B87522' }} />
            </div>
            <div style={{ marginTop: 4, color: percentage > 100 ? '#9B463E' : '#79502A', fontSize: 11 }}>
              {percentage > 100
                ? `${money(item.spending - item.budget)} over budget`
                : `${money(Math.max(0, item.budget - item.spending))} remaining · ${percentageLabel}`}
            </div>
          </>
        )}
      </button>
    )
  }

  if (isSettingsOpen) {
    return (
      <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <button type="button" onClick={closeBudgetSettings} style={button}>‹ Budgets</button>
          <h1 style={{ flex: 1, margin: 0, color: '#B87522', fontFamily: 'Georgia, serif', fontStyle: 'italic', textAlign: 'right' }}>
            Budget Settings
          </h1>
        </div>
        <section style={{ ...card, padding: '12px 14px' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Budget Mode</h2>
          <div style={{ display: 'grid', gap: 6 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, borderRadius: 9, background: draftBudgetSettings.mode === 'manual' ? '#F5D6A5' : '#FFF8ED', color: '#493320', fontSize: 12 }}>
              <input type="radio" name="budget-mode" checked={draftBudgetSettings.mode === 'manual'} onChange={() => updateBudgetSetting('mode', 'manual')} />
              <span><strong>Manual</strong><br /><span style={{ color: '#79502A' }}>I choose my own category budget amounts.</span></span>
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: 8, borderRadius: 9, background: draftBudgetSettings.mode === 'smart' ? '#F5D6A5' : '#FFF8ED', color: '#493320', fontSize: 12 }}>
              <input type="radio" name="budget-mode" checked={draftBudgetSettings.mode === 'smart'} onChange={() => updateBudgetSetting('mode', 'smart')} />
              <span><strong>Smart Budget</strong><br /><span style={{ color: '#79502A' }}>Suggest amounts from your history for approval.</span></span>
            </label>
          </div>
          <label style={{ display: 'grid', gap: 4, marginTop: 10, color: '#493320', fontSize: 12 }}>
            Budget period
            <select value={draftBudgetSettings.period} onChange={event => updateBudgetSetting('period', event.target.value)} style={button}>
              <option value="monthly">Monthly</option>
              <option value="paycheck">Paycheck-to-Paycheck</option>
            </select>
          </label>
          {draftBudgetSettings.period === 'paycheck' && (
            <p style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11 }}>
              Paycheck-to-Paycheck periods are saved but not yet applied to budget totals.
            </p>
          )}
          {draftBudgetSettings.mode === 'smart' && (
            <label style={{ display: 'grid', gap: 4, marginTop: 10, color: '#493320', fontSize: 12 }}>
              Smart Budget spending history
              <select value={draftBudgetSettings.historyMonths} onChange={event => updateBudgetSetting('historyMonths', Number(event.target.value))} style={button}>
                <option value="3">3 complete months</option>
                <option value="6">6 complete months</option>
                <option value="12">12 complete months</option>
              </select>
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, color: '#493320', fontSize: 12 }}>
            <input type="checkbox" checked={draftBudgetSettings.suggestionsEnabled} onChange={event => updateBudgetSetting('suggestionsEnabled', event.target.checked)} />
            Budget suggestions
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, color: '#493320', fontSize: 12 }}>
            <input type="checkbox" checked={draftBudgetSettings.rolloverEnabled} onChange={event => updateBudgetSetting('rolloverEnabled', event.target.checked)} />
            Rollover unused funds
          </label>
          {draftBudgetSettings.mode === 'smart' && (
            <p style={{ margin: '8px 0 0', color: '#79502A', fontSize: 11 }}>
              Suggestions use complete calendar months and require approval. Paycheck-to-Paycheck periods are not yet applied to Smart recommendations.
            </p>
          )}
          {draftBudgetSettings.rolloverEnabled && (
            <p style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11 }}>
              Rollover is saved as a preference but is not yet applied to calculations.
            </p>
          )}
          <button type="button" onClick={saveSettings} style={{ ...button, display: 'block', width: '100%', marginTop: 12, background: '#B87522', color: '#FFFFFF', fontWeight: 'bold' }}>
            Save Settings
          </button>
        </section>
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button type="button" onClick={onBack} style={button}>‹ More</button>
        <h1 style={{ flex: 1, margin: 0, color: '#B87522', fontFamily: 'Georgia, serif', fontStyle: 'italic', textAlign: 'right' }}>
          Budgets
        </h1>
        <button type="button" aria-label="Budget settings" onClick={openBudgetSettings} style={{ ...button, padding: 8, fontSize: 17 }}>
          ⚙
        </button>
      </div>

      <section style={{ ...card, padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#79502A', fontSize: 12 }}>
          <span>{mode === 'smart' ? 'Smart Budget total' : 'Monthly budget'}</span>
          <strong style={{ color: '#493320' }}>{configured.length ? money(configuredTotal) : 'Not set'}</strong>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 5, color: '#79502A', fontSize: 12 }}>
          <span>Spending this month</span>
          <strong style={{ color: '#493320' }}>{actualTotal ? money(actualTotal) : 'No spending data'}</strong>
        </div>
        {mode === 'smart' && smartAnalysis && !smartAnalysis.categories.some(item => item.hasEnoughHistory) && (
          <p style={{ margin: '5px 0 0', color: '#79502A', fontSize: 11 }}>
            Not enough spending history yet. Categorize more transactions to unlock suggestions.
          </p>
        )}
      </section>

      {mode === 'smart' && (
        <section style={{ ...card, padding: '2px 14px' }}>
          <button type="button" onClick={() => setShowSuggestions(value => !value)} style={{
            ...button, display: 'flex', justifyContent: 'space-between', width: '100%',
            padding: '9px 0', border: 'none', background: 'transparent', fontWeight: 'bold', textAlign: 'left'
          }}>
            <span>Suggestions for You ({suggestionItems.length})</span>
            <span>{showSuggestions ? '⌃' : '⌄'}</span>
          </button>
          {showSuggestions && (
            suggestionItems.length ? suggestionItems.map(item => (
              <div key={item.category} style={{ padding: '8px 0', borderTop: '1px solid #EEE5D9', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{item.category}</strong>
                  <span style={{ color: '#79502A', textAlign: 'right' }}>
                    Typical {money(item.average)} · Suggested {money(item.suggestedBudget)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                  <button type="button" onClick={() => acceptSuggestion(item)} style={{ ...button, padding: '6px 8px', background: '#B87522', color: '#FFFFFF' }}>Accept</button>
                  <button type="button" onClick={() => openBudgetEditor(item)} style={{ ...button, padding: '6px 8px' }}>Adjust</button>
                  <button type="button" onClick={() => dismissSuggestion(item)} style={{ ...button, padding: '6px 8px', color: '#9B463E' }}>Dismiss</button>
                </div>
              </div>
            )) : (
              <p style={{ margin: '0 0 9px', color: '#79502A', fontSize: 11 }}>
                {!budgetSettings.suggestionsEnabled
                  ? 'Suggestions are off in Budget Settings.'
                  : smartAnalysis?.categories.some(item => item.hasEnoughHistory)
                  ? 'No pending suggestions.'
                  : 'Not enough spending history yet. Categorize more transactions to unlock suggestions.'}
              </p>
            )
          )}
        </section>
      )}

      <section style={{ ...card, padding: '2px 14px' }}>
        <p style={{ margin: '8px 0 2px', color: '#B87522', fontSize: 12, fontWeight: 'bold' }}>
          {mode === 'smart' ? 'Smart Budget' : 'Manual Budget'}
        </p>
        {configured.length ? configured.map(renderRow) : (
          <p style={{ margin: '8px 0', color: '#79502A', fontSize: 11 }}>
            {mode === 'smart' ? 'Approve a suggestion to set a Smart Budget.' : 'No budgets set yet.'}
          </p>
        )}
        {other.length > 0 && (
          <div>
            <button type="button" onClick={() => setShowOtherCategories(value => !value)} style={{
              ...button, display: 'flex', justifyContent: 'space-between', width: '100%',
              margin: '8px 0', padding: '8px 0', border: 'none', background: 'transparent',
              fontWeight: 'bold', textAlign: 'left'
            }}>
              <span>Other Categories ({other.length})</span>
              <span>{showOtherCategories ? '⌃' : '⌄'}</span>
            </button>
            {showOtherCategories && other.map(renderRow)}
          </div>
        )}
      </section>

      {notice && (
        <p role="status" style={{ margin: '8px 2px', color: '#79502A', fontSize: 11 }}>
          {notice}
        </p>
      )}
      {editingBudget && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', padding: 20, background: '#33231266' }}>
          <section role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 380, padding: 18, borderRadius: 16, background: '#FFF8ED' }}>
            <h2 style={{ margin: '0 0 12px', color: '#79502A', fontSize: 18 }}>
              {budgets[editingBudget] == null
                ? mode === 'smart' ? 'Review Smart Budget' : 'Set Budget'
                : mode === 'smart' ? 'Edit Smart Budget' : 'Edit Budget'}
            </h2>
            <p style={{ margin: '0 0 10px', color: '#493320', fontSize: 13 }}>
              <strong>{editingBudget}</strong>
            </p>
            <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 12 }}>
              {mode === 'smart' ? 'Approved Smart Budget amount' : 'Monthly budget amount'}
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                aria-label="Monthly budget amount"
                value={budgetAmount}
                onChange={event => setBudgetAmount(event.target.value)}
                style={{ ...button, boxSizing: 'border-box', width: '100%' }}
              />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setEditingBudget(null)} style={button}>Cancel</button>
              <button type="button" onClick={saveBudget} style={{ ...button, background: '#B87522', color: '#FFFFFF', fontWeight: 'bold' }}>Save</button>
            </div>
            {budgets[editingBudget] != null && (
              <button type="button" onClick={deleteBudget} style={{ display: 'block', margin: '10px auto 0', border: 'none', background: 'transparent', color: '#9B463E', cursor: 'pointer' }}>
                Delete Budget
              </button>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
