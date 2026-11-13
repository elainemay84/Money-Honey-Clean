
import { useEffect, useState } from 'react'
import Accounts from './Accounts'
import Debt from './Debt'
import { startingAccounts, startingTransactions } from './accountDefaults.js'
import Bills from './Bills'
import Settings from './Settings'
import Budgets from './Budgets'
import Themes from './Themes'
import Backup from './Backup'
import DeleteConfirmation from './DeleteConfirmation'
import PendingOperationNotice from './PendingOperationNotice'
import Reports from './Reports'
import { clearProfileActionNotice, getProfileActionNotice } from './profileActionNotice.js'
import { clearRestoreNotice, hasRestoreNotice } from './backupRestoreNotice.js'
import PageHeader from './PageHeader'
import {
  createDemoBills,
  getTodayDate,
  getPaydayBillSummary,
  getPaySchedulePeriod,
  loadBills,
  loadIncomeSchedules,
  loadPaySchedule,
  savePaySchedule
} from './billData.js'
import { loadAccountData, loadSavedAccountData, saveAccountData } from './accountStorage.js'
import { loadDebts } from './debtData.js'
import { calculatePaycheckForecast } from './paycheckForecast.js'
import { calculateBudgetSnapshot, loadBudgetSettings, loadBudgets } from './budgetData.js'
import { getCategories, loadCategoryConfig } from './categoryData.js'
import { calculateDailySpending } from './dailySpending.js'
import { loadAppearanceSize, saveAppearanceSize } from './appearanceData.js'
import {
  FONT_STYLES,
  getNavigationColors,
  getThemeBackground,
  getThemeStyle,
  LINE_SPACING,
  loadThemeSettings,
  previewTextColor,
  saveThemeSettings
} from './themeData.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const formatForecastDate = date => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})

function App() {
  const [today] = useState(getTodayDate)
  const [bills, setBills] = useState(() => loadBills(createDemoBills()))
  const [incomeSchedules, setIncomeSchedules] = useState(() => loadIncomeSchedules())
  const [paySchedule, setPaySchedule] = useState(() => loadPaySchedule())
  const [accountData, setAccountData] = useState(() =>
    loadAccountData(startingAccounts, startingTransactions)
  )
  const [debts, setDebts] = useState(() => loadDebts())
  const [isForecastOpen, setIsForecastOpen] = useState(false)
  const [isDailyAllowanceOpen, setIsDailyAllowanceOpen] = useState(false)
  const [isEditingPaySchedule, setIsEditingPaySchedule] = useState(false)
  const [payFrequency, setPayFrequency] = useState(paySchedule?.frequency ?? 'biweekly')
  const [nextPayday, setNextPayday] = useState(paySchedule?.nextPayday ?? today)
  const [activePage, setActivePage] = useState(() => hasRestoreNotice() || getProfileActionNotice() ? 'Settings' : 'Home')
  const [budgetSettings, setBudgetSettings] = useState(() => loadBudgetSettings())
  const [, setBudgetRevision] = useState(0)
  const [settingsView, setSettingsView] = useState(() => hasRestoreNotice() ? 'backup' : getProfileActionNotice() ?? 'menu')
  const [appearanceSize, setAppearanceSize] = useState(() => loadAppearanceSize())
  const [themeSettings, setThemeSettings] = useState(() => loadThemeSettings())
  const [themePreview, setThemePreview] = useState(null)
  const activeTheme = themePreview ?? themeSettings
  const themeStyle = getThemeStyle(activeTheme.themeId)
  const isCustomTheme = activeTheme.themeId.startsWith('custom-')
  const themeBackground = getThemeBackground(activeTheme)
  const isGradientBackground = activeTheme.backgroundStyle?.type === 'gradient'
  const themeNavigation = isCustomTheme
    ? activeTheme.colors.tabs ?? activeTheme.colors.accent
    : themeStyle.nav
  const navigationColors = themeStyle.navActive && themeStyle.navInactive
    ? { active: themeStyle.navActive, inactive: themeStyle.navInactive }
    : getNavigationColors(themeNavigation, activeTheme.colors.accent)
  const paydayPeriod = getPaySchedulePeriod(paySchedule, today)
  const transactions = accountData?.transactions ?? []
  const paycheckForecast = calculatePaycheckForecast({
    accounts: accountData?.accounts ?? [],
    transactions,
    bills,
    incomes: incomeSchedules,
    today
  })
  const hasPaycheckForecast = paycheckForecast.hasIncomeSchedule && paycheckForecast.nextPayday
  const paydaySummary = getPaydayBillSummary(
    bills,
    hasPaycheckForecast
      ? { startDate: paycheckForecast.startDate, endDate: paycheckForecast.endDate }
      : paydayPeriod,
    transactions
  )
  const activeDebts = debts.filter(debt => !debt.archived)
  const totalStartingDebt = activeDebts.reduce((total, debt) => total + debt.startingBalance, 0)
  const totalCurrentDebt = activeDebts.reduce((total, debt) => total + debt.currentBalance, 0)
  const debtProgress = totalStartingDebt > 0
    ? Math.round((1 - totalCurrentDebt / totalStartingDebt) * 100)
    : 0
  const categoryConfig = loadCategoryConfig()
  const budgetCategories = getCategories(
    categoryConfig.customCategories,
    'expense',
    categoryConfig.builtInNames,
    categoryConfig.disabledBuiltIns
  )
  const budgetSnapshot = calculateBudgetSnapshot({
    transactions,
    today,
    categories: budgetCategories,
    mode: budgetSettings.mode,
    budgets: loadBudgets(budgetSettings.mode)
  })
  const rollingForecastEnd = new Date(`${today}T00:00:00Z`)
  rollingForecastEnd.setUTCDate(rollingForecastEnd.getUTCDate() + 29)
  const rollingCashFlowForecast = calculatePaycheckForecast({
    accounts: accountData?.accounts ?? [],
    transactions,
    bills,
    incomes: incomeSchedules,
    today,
    forecastEndDate: rollingForecastEnd.toISOString().slice(0, 10)
  })
  const dailySpending = calculateDailySpending({
    transactions,
    today,
    forecast: rollingCashFlowForecast,
    categories: budgetCategories,
    budgets: loadBudgets(budgetSettings.mode)
  })
  const dailyValue = value => value == null ? 'Not enough information' : money(value)
  const remainingDailyValue = dailySpending.remainingToday == null
    ? 'Not enough information'
    : dailySpending.remainingToday < 0
      ? `${money(Math.abs(dailySpending.remainingToday))} over`
      : money(dailySpending.remainingToday)

  useEffect(() => {
    const refreshData = () => {
      setBills(loadBills(createDemoBills()))
      setIncomeSchedules(loadIncomeSchedules())
    }
    window.addEventListener('money-honey-bills-updated', refreshData)
    window.addEventListener('storage', refreshData)
    return () => {
      window.removeEventListener('money-honey-bills-updated', refreshData)
      window.removeEventListener('storage', refreshData)
    }
  }, [])

  useEffect(() => {
    const refreshDebts = () => setDebts(loadDebts())
    window.addEventListener('money-honey-debts-updated', refreshDebts)
    window.addEventListener('storage', refreshDebts)
    return () => {
      window.removeEventListener('money-honey-debts-updated', refreshDebts)
      window.removeEventListener('storage', refreshDebts)
    }
  }, [])

  useEffect(() => {
    const refreshBudgets = () => setBudgetRevision(value => value + 1)
    const refreshBudgetSettings = () => setBudgetSettings(loadBudgetSettings())
    window.addEventListener('money-honey-budgets-updated', refreshBudgets)
    window.addEventListener('money-honey-budget-settings-updated', refreshBudgetSettings)
    window.addEventListener('storage', refreshBudgetSettings)
    return () => {
      window.removeEventListener('money-honey-budgets-updated', refreshBudgets)
      window.removeEventListener('money-honey-budget-settings-updated', refreshBudgetSettings)
      window.removeEventListener('storage', refreshBudgetSettings)
    }
  }, [])

  const isBackupOpen = activePage === 'Settings' && settingsView === 'backup'
  useEffect(() => {
    if (!isBackupOpen) clearRestoreNotice()
  }, [isBackupOpen])

  const isProfileActionOpen = activePage === 'Settings' && (settingsView === 'reset' || settingsView === 'delete')
  useEffect(() => {
    if (!isProfileActionOpen) clearProfileActionNotice()
  }, [isProfileActionOpen])

  useEffect(() => {
    if (activePage !== 'Home') return
    setIsForecastOpen(false)
    setIsEditingPaySchedule(false)
  }, [activePage])

  useEffect(() => {
    const refreshAccountData = () => setAccountData(loadSavedAccountData())
    window.addEventListener('money-honey-accounts-updated', refreshAccountData)
    window.addEventListener('storage', refreshAccountData)
    return () => {
      window.removeEventListener('money-honey-accounts-updated', refreshAccountData)
      window.removeEventListener('storage', refreshAccountData)
    }
  }, [])

  function savePaydaySchedule(event) {
    event.preventDefault()
    if (!nextPayday) return
    const schedule = { frequency: payFrequency, nextPayday }
    savePaySchedule(schedule)
    setPaySchedule(schedule)
    setIsEditingPaySchedule(false)
  }

  function updateSettingsTransactions(nextTransactions) {
    setAccountData(current => ({ ...current, transactions: nextTransactions }))
    saveAccountData(accountData.accounts, nextTransactions)
  }

  const settingsMenuItems = [
    {
      key: 'themes',
      icon: '◉',
      title: 'Themes & Fonts',
      description: 'Change colors, background, accent, and font.'
    },
    {
      key: 'categories',
      icon: '☷',
      title: 'Categories & Payees',
      description: 'Edit categories, stores, and payees.'
    },
    {
      key: 'backup',
      icon: '☁',
      title: 'Backup & Transfer',
      description: 'Export, import, or move your data from another file.'
    },
    {
      key: 'reset',
      icon: '↶',
      title: 'Reset App Data',
      description: 'Clear app data while preserving your account records.'
    },
    {
      key: 'delete',
      icon: '♙',
      title: 'Delete Profile',
      description: 'Permanently delete your profile and associated data.'
    }
  ]

  return (
    <div
      className={`app-shell appearance-${appearanceSize} theme-${activeTheme.themeId} theme-typography theme-customized`}
      style={{
      minHeight: '100vh',
      background: themeBackground,
      color: activeTheme.colors.text,
      fontFamily: 'Arial, sans-serif',
      '--theme-background': themeBackground,
      '--theme-card': activeTheme.colors.card,
      '--theme-accent': activeTheme.colors.accent,
      '--theme-text': activeTheme.colors.text,
      '--theme-border': `${activeTheme.colors.accent}66`,
      '--theme-heading-font': FONT_STYLES[activeTheme.headingFont].family,
      '--theme-body-font': FONT_STYLES[activeTheme.bodyFont].family,
      '--theme-line-spacing': LINE_SPACING[activeTheme.lineSpacing ?? 'normal'],
      '--theme-radius': themeStyle.radius,
      '--theme-shadow': themeStyle.shadow,
      '--theme-pattern': isGradientBackground
        ? themeBackground
        : isCustomTheme ? 'none' : themeStyle.pattern,
      '--theme-pattern-size': isGradientBackground || isCustomTheme ? 'auto' : themeStyle.patternSize,
      '--theme-nav': themeNavigation,
      '--theme-nav-text': navigationColors.inactive,
      '--theme-nav-active': navigationColors.active,
      '--theme-button-text': themeStyle.buttonText,
      '--theme-secondary-text': previewTextColor(activeTheme.colors.card),
      '--theme-muted-text': previewTextColor(activeTheme.colors.card),
      '--theme-modal-text': activeTheme.colors.text,
      '--theme-separator-text': previewTextColor('#F5D6A5'),
      '--theme-status-text': '#304035',
      '--theme-status-success-text': '#1D6339',
      '--theme-danger-text': '#8F302D',
      padding: '24px 24px calc(112px + env(safe-area-inset-bottom))'
    }}
    >
      <PendingOperationNotice />
{activePage === 'Home' ? (
      <main style={{ maxWidth: 460, margin: 'auto' }}>
        <h1 style={{
          margin: '0 0 6px',
          color: '#B87522',
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          textAlign: 'center'
        }}>
          Money, Honey 🍯
        </h1>

        <p style={{ margin: '0 0 14px', textAlign: 'center', color: '#79502A', fontSize: 13 }}>
          Your financial snapshot
        </p>

        <section style={{
          background: '#F5D6A5',
          padding: '16px 18px',
          borderRadius: 16,
          marginBottom: 12
        }}>
          <p style={{ margin: 0, color: '#79502A', fontSize: 11, fontWeight: 'bold', letterSpacing: 0.5 }}>
            LEFT UNTIL PAYDAY
          </p>
          <h2 style={{ fontSize: 32, lineHeight: 1.1, margin: '5px 0 3px', color: '#493320' }}>
            {hasPaycheckForecast
              ? money(paycheckForecast.projectedRemainingFunds)
              : 'Set up income'}
          </h2>
          <p style={{ margin: 0, color: '#79502A', fontSize: 12 }}>
            {hasPaycheckForecast
              ? `Next payday · ${formatForecastDate(paycheckForecast.nextPayday)}`
              : 'Set up income to see your forecast'}
          </p>
          <details
            open={isForecastOpen}
            onToggle={event => setIsForecastOpen(event.currentTarget.open)}
            style={{ marginTop: 12, color: '#79502A', fontSize: 12 }}
          >
            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
              Paycheck-to-Paycheck Forecast
            </summary>
            {hasPaycheckForecast ? (
              <div style={{ display: 'grid', gap: 6, marginTop: 9 }}>
                {[
                  ['Available Funds', money(paycheckForecast.availableFunds)],
                  ['Upcoming Income', money(paycheckForecast.upcomingIncome)],
                  ['Scheduled Bills', money(paycheckForecast.scheduledBills)],
                  ['Projected Remaining Funds', money(paycheckForecast.projectedRemainingFunds)]
                ].map(([label, value]) => (
                  <div key={label} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 10,
                    paddingBottom: 5,
                    borderBottom: '1px solid #D8B87F'
                  }}>
                    <span>{label}</span>
                    <strong style={{ color: '#493320', whiteSpace: 'nowrap' }}>{value}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ margin: '9px 0 0' }}>Set up income to see your forecast</p>
            )}
          </details>
        </section>

        <section style={{
          background: '#FFFFFF',
          padding: '14px 16px',
          borderRadius: 16,
          marginBottom: 12
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 10
          }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Bills Before Payday</h2>
            <button
              type="button"
              onClick={() => setIsEditingPaySchedule(value => !value)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#B87522',
                fontSize: 11,
                cursor: 'pointer',
                padding: 4
              }}
            >
              {isEditingPaySchedule ? 'Close settings' : 'Payday settings'}
            </button>
          </div>

          {isEditingPaySchedule ? (
            <form onSubmit={savePaydaySchedule} style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
                  Pay frequency
                  <select
                    value={payFrequency}
                    onChange={event => setPayFrequency(event.target.value)}
                    style={{ padding: 7, border: '1px solid #E9D6B7', borderRadius: 8, background: '#FFFFFF' }}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every two weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 11 }}>
                  Next payday
                  <input
                    type="date"
                    value={nextPayday}
                    onChange={event => setNextPayday(event.target.value)}
                    required
                    style={{ padding: 7, border: '1px solid #E9D6B7', borderRadius: 8, background: '#FFFFFF' }}
                  />
                </label>
              </div>
              <button
                type="submit"
                style={{
                  justifySelf: 'end',
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 10px',
                  background: '#B87522',
                  color: '#FFFFFF',
                  fontSize: 12,
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Save schedule
              </button>
            </form>
          ) : paydaySummary ? (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 8,
                marginBottom: 10
              }}>
                {[
                  ['TOTAL DUE', paydaySummary.totalDue, '#B87522'],
                  ['CLEARED', paydaySummary.cleared, '#21834B'],
                  ['REMAINING', paydaySummary.remaining, '#9B463E']
                ].map(([label, amount, color]) => (
                  <div key={label} style={{ minWidth: 0 }}>
                    <div style={{ color: '#79502A', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.3 }}>
                      {label}
                    </div>
                    <strong style={{
                      display: 'block',
                      marginTop: 3,
                      color,
                      fontSize: 15,
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {money(amount)}
                    </strong>
                  </div>
                ))}
              </div>
              <div
                role="progressbar"
                aria-label="Bills cleared"
                aria-valuemin={0}
                aria-valuemax={paydaySummary.totalCount}
                aria-valuenow={paydaySummary.clearedCount}
                style={{ height: 7, overflow: 'hidden', borderRadius: 999, background: '#F1EEE9' }}
              >
                <div style={{
                  width: paydaySummary.totalCount
                    ? `${(paydaySummary.clearedCount / paydaySummary.totalCount) * 100}%`
                    : '0%',
                  height: '100%',
                  borderRadius: 999,
                  background: '#6E9A72',
                  transition: 'width 160ms ease'
                }} />
              </div>
              <p style={{ margin: '6px 0 0', color: '#79502A', fontSize: 11 }}>
                {paydaySummary.clearedCount} of {paydaySummary.totalCount} bills cleared
              </p>
              {hasPaycheckForecast && paycheckForecast.nextPaydayIncome > 0 && (
                <div style={{
                  marginTop: 10,
                  paddingTop: 9,
                  borderTop: '1px solid #EEE5D9',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  color: '#79502A',
                  fontSize: 12
                }}>
                  <span>Income expected · {formatForecastDate(paycheckForecast.nextPayday)}</span>
                  <strong style={{ color: '#21834B', whiteSpace: 'nowrap' }}>
                    {money(paycheckForecast.nextPaydayIncome)}
                  </strong>
                </div>
              )}
            </>
          ) : (
            <p style={{ margin: 0, color: '#79502A', fontSize: 12 }}>
              Set up a payday schedule to see this summary.
            </p>
          )}
        </section>

        <button
          type="button"
          aria-label="Open daily spending allowance explanation"
          onClick={() => setIsDailyAllowanceOpen(true)}
          style={{
            display: 'block',
            width: '100%',
            border: 'none',
          background: '#FFFFFF',
          padding: '14px 16px',
          borderRadius: 16,
            marginBottom: 12,
            color: '#493320',
            textAlign: 'left',
            cursor: 'pointer',
            transition: 'box-shadow 120ms ease, transform 120ms ease'
          }}
          onMouseDown={event => {
            event.currentTarget.style.transform = 'scale(0.995)'
            event.currentTarget.style.boxShadow = '0 2px 8px rgba(73, 51, 32, 0.12)'
          }}
          onMouseUp={event => {
            event.currentTarget.style.transform = ''
            event.currentTarget.style.boxShadow = ''
          }}
          onMouseLeave={event => {
            event.currentTarget.style.transform = ''
            event.currentTarget.style.boxShadow = ''
          }}
        >
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Daily Spending</h2>
          <div style={{ display: 'grid', gap: 7 }}>
            {[
              ['Average daily spending', dailyValue(dailySpending.averageDailySpending)],
              ['Today’s spending', money(dailySpending.todaySpending)],
              ['Available to spend today', remainingDailyValue]
            ].map(([label, value]) => {
              const row = {
                display: 'flex',
                justifyContent: 'space-between',
                gap: 10,
                color: '#79502A',
                fontSize: 12
              }
              return (
                <div key={label} style={row}>
                  <span>{label}</span>
                  <strong style={{
                    color: label === 'Available to spend today' && dailySpending.remainingToday < 0
                      ? '#9B463E'
                      : '#493320',
                    whiteSpace: 'nowrap'
                  }}>{value}</strong>
                </div>
              )
            })}
          </div>
        </button>

        {isDailyAllowanceOpen && (
          <div
            role="presentation"
            onClick={() => setIsDailyAllowanceOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 20,
              background: 'rgba(73, 51, 32, 0.28)',
              display: 'flex',
              alignItems: 'flex-end'
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="daily-allowance-title"
              onClick={event => event.stopPropagation()}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '16px 18px 20px',
                borderRadius: '18px 18px 0 0',
                background: '#FFF9EF',
                color: '#493320',
                boxShadow: '0 -6px 24px rgba(73, 51, 32, 0.18)'
              }}
            >
              <h2 id="daily-allowance-title" style={{ margin: '0 0 10px', fontSize: 18 }}>
                Your Daily Allowance
              </h2>
              <div style={{
                marginBottom: 10,
                padding: '13px 15px',
                borderRadius: 12,
                background: '#F6D58A',
                color: '#493320',
                textAlign: 'center'
              }}>
                <div style={{ fontSize: 12, fontWeight: 'bold' }}>Available to spend today</div>
                <strong style={{ display: 'block', marginTop: 4, fontSize: 28 }}>
                  {remainingDailyValue}
                </strong>
              </div>
              <div style={{ display: 'grid', gap: 6, color: '#79502A', fontSize: 12 }}>
                {[
                  ['Available funds', dailySpending.explanation.currentAvailableFunds],
                  ['Expected income over the next 30 days', dailySpending.explanation.expectedIncome],
                  ['Upcoming bills and debt payments', dailySpending.explanation.upcomingBills],
                  ['Protected funds', dailySpending.explanation.protectedFunds]
                ].map(([label, amount]) => amount == null ? null : (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{label}</span>
                    <strong style={{ color: '#493320', whiteSpace: 'nowrap' }}>{money(amount)}</strong>
                  </div>
                ))}
              </div>
              <p style={{ margin: '11px 0', color: '#79502A', fontSize: 12 }}>
                {dailySpending.explanation.limitingConstraint}
              </p>
              <p style={{ margin: '-4px 0 0', color: '#9A7652', fontSize: 11 }}>
                Protected funds are reserved by the forecast, not a separate bank account.
              </p>
              <button
                type="button"
                onClick={() => setIsDailyAllowanceOpen(false)}
                style={{
                  width: '100%',
                  marginTop: 13,
                  padding: '9px 12px',
                  border: 'none',
                  borderRadius: 9,
                  background: '#B87522',
                  color: '#FFFFFF',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </section>
          </div>
        )}

        <section style={{
          background: '#FFFFFF',
          padding: '14px 16px',
          borderRadius: 16,
          marginBottom: 12
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>Budget Snapshot</h2>
            <button
              type="button"
              onClick={() => setActivePage('Budgets')}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#B87522',
                fontSize: 11,
                cursor: 'pointer',
                padding: 4
              }}
            >
              View Budgets
            </button>
          </div>
          {budgetSettings.mode === 'smart' && !budgetSnapshot.hasBudgets ? (
            <p style={{ margin: '8px 0 0', color: '#79502A', fontSize: 12 }}>
              Smart Budget is learning your spending.
            </p>
          ) : (
            <>
              <div style={{ display: 'grid', gap: 5, marginTop: 8, color: '#79502A', fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>{budgetSettings.mode === 'smart' ? 'Smart Budget' : 'Manual Budget'}</span>
                  <strong style={{ color: '#493320' }}>
                    {budgetSnapshot.hasBudgets ? money(budgetSnapshot.budgetTotal) : 'Not set'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>Spent this month</span>
                  <strong style={{ color: '#493320' }}>{money(budgetSnapshot.actualSpending)}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span>Remaining</span>
                  <strong style={{ color: budgetSnapshot.actualSpending > budgetSnapshot.budgetTotal ? '#9B463E' : '#493320' }}>
                    {budgetSnapshot.hasBudgets
                      ? budgetSnapshot.actualSpending > budgetSnapshot.budgetTotal
                        ? `${money(budgetSnapshot.actualSpending - budgetSnapshot.budgetTotal)} over budget`
                        : money(budgetSnapshot.remaining)
                      : 'Not set'}
                  </strong>
                </div>
              </div>
              {budgetSnapshot.hasBudgets && (
                <div role="progressbar" aria-label="Budget snapshot spending progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={budgetSnapshot.progress} style={{
                  height: 5, marginTop: 8, overflow: 'hidden', borderRadius: 999, background: '#F1EEE9'
                }}>
                  <div style={{ width: `${budgetSnapshot.progress}%`, height: '100%', borderRadius: 999, background: budgetSnapshot.progress >= 100 ? '#9B463E' : '#B87522' }} />
                </div>
              )}
            </>
          )}
        </section>

        <button
          type="button"
          onClick={() => setActivePage('Debt')}
          style={{
            display: 'block',
            width: '100%',
            border: 'none',
            background: '#FFFFFF',
            color: '#493320',
            padding: '14px 16px',
            borderRadius: 16,
            textAlign: 'left',
            cursor: 'pointer'
          }}
        >
          <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Debt Journey</h2>
          <progress value={debtProgress} max="100" style={{ width: '100%' }} />
          <p style={{ margin: '7px 0 0', color: '#79502A', fontSize: 12 }}>
            {activeDebts.length && totalStartingDebt > 0
              ? `${debtProgress}% paid off`
              : 'Set up a debt to track progress'}
          </p>
        </button>

        <p style={{ textAlign: 'center', margin: '18px 0 0', color: '#79502A', fontSize: 12 }}>
          Made with a little buzz and a lot of honey. 🐝
        </p>
      </main>


) : activePage === 'Accounts' ? (
  <Accounts />
) : activePage === 'Bills' ? (
  <Bills />
) : activePage === 'Debt' ? (
  <Debt />
) : activePage === 'Settings' ? (
  settingsView === 'categories' ? (
    <Settings
      transactions={transactions}
      onTransactionsChange={updateSettingsTransactions}
      onBack={() => {
        setSettingsView('menu')
      }}
    />
  ) : settingsView === 'themes' ? (
    <Themes
      settings={themePreview ?? themeSettings}
      onPreview={setThemePreview}
      onManualTheme={() => setSettingsView('manual-theme')}
      onSave={settings => {
        const saved = saveThemeSettings(settings)
        setThemeSettings(saved)
        setThemePreview(null)
        return saved
      }}
      onBack={() => {
        setThemePreview(null)
        setSettingsView('menu')
      }}
    />
  ) : settingsView === 'manual-theme' ? (
    <Themes
      settings={themePreview ?? themeSettings}
      onPreview={setThemePreview}
      manualMode
      appearanceSize={appearanceSize}
      onAppearanceSizeChange={size => setAppearanceSize(saveAppearanceSize(size))}
      onSave={settings => {
        const saved = saveThemeSettings(settings)
        setThemeSettings(saved)
        setThemePreview(null)
        return saved
      }}
      onBack={() => {
        setThemePreview(null)
        setSettingsView('themes')
      }}
    />
  ) :   settingsView === 'backup' ? (
    <Backup
      onBack={() => setSettingsView('menu')}
      onHome={() => {
        setSettingsView('menu')
        setActivePage('Home')
      }}
    />
  ) : settingsView === 'reset' || settingsView === 'delete' ? (
    <DeleteConfirmation
      key={settingsView}
      kind={settingsView}
      onBack={() => setSettingsView('menu')}
    />
  ) : settingsView !== 'menu' ? (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader backLabel="Settings" onBack={() => setSettingsView('menu')}>
        {settingsMenuItems.find(item => item.key === settingsView)?.title ?? 'Settings'}
      </PageHeader>
      <section style={{
        padding: 16,
        border: '1px solid #E9D6B7',
        borderRadius: 14,
        background: '#FFFFFF',
        color: '#79502A'
      }}>
        <strong style={{ color: '#493320' }}>Coming Soon</strong>
        <p style={{ margin: '7px 0 0', fontSize: 13, lineHeight: 1.5 }}>
          This Settings feature is planned but is not available yet.
        </p>
      </section>
    </main>
  ) : (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <h1 style={{ color: '#B87522', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>Settings</h1>
      <section style={{
        marginBottom: 12,
        padding: 14,
        border: '1px solid #E9D6B7',
        borderRadius: 14,
        background: '#FFFFFF',
        color: '#493320'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{
            display: 'grid',
            placeItems: 'center',
            width: 34,
            height: 34,
            borderRadius: 10,
            background: '#EEF1DF',
            color: '#493320',
            fontSize: 20,
            fontWeight: 'bold'
          }}>T</span>
          <div>
            <h2 style={{ margin: 0, fontSize: 17 }}>Appearance Size</h2>
            <p style={{ margin: '2px 0 0', color: '#79502A', fontSize: 12 }}>
              Make everything smaller or larger.
            </p>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
          {[
            ['small', 'Small'],
            ['medium', 'Medium'],
            ['large', 'Large']
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={appearanceSize === value}
              onClick={() => setAppearanceSize(saveAppearanceSize(value))}
              style={{
                minHeight: 44,
                padding: '9px 8px',
                border: `1px solid ${appearanceSize === value ? '#8FA06C' : '#E9D6B7'}`,
                borderRadius: 999,
                background: appearanceSize === value ? '#8FA06C' : '#FFFFFF',
                color: appearanceSize === value ? '#1F291A' : '#79502A',
                fontSize: 12,
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      <div style={{ display: 'grid', gap: 10 }}>
        {settingsMenuItems.map(item => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSettingsView(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              padding: 14,
              border: '1px solid #E9D6B7',
              borderRadius: 14,
              background: '#FFFFFF',
              color: '#493320',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <span aria-hidden="true" style={{
              display: 'grid',
              placeItems: 'center',
              flex: '0 0 34px',
              width: 34,
              height: 34,
              borderRadius: 10,
              background: '#EEF1DF',
              color: '#493320',
              fontSize: 20,
              fontWeight: 'bold'
            }}>
              {item.icon}
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ display: 'block', fontSize: 15 }}>{item.title}</strong>
              <span style={{ display: 'block', marginTop: 3, color: '#79502A', fontSize: 12 }}>
                {item.description}
              </span>
            </span>
            <span aria-hidden="true" style={{ color: '#B87522', fontSize: 20 }}>›</span>
          </button>
        ))}
      </div>
    </main>
  )
) : activePage === 'Budgets' ? (
  <Budgets
    transactions={transactions}
    today={today}
    onBack={() => setActivePage('More')}
  />
) : activePage === 'Reports' ? (
  <Reports
    transactions={transactions}
    accounts={accountData?.accounts ?? []}
    today={today}
    cardColor={activeTheme.colors.card}
    onBack={() => setActivePage('More')}
  />
) : activePage === 'More' ? (
  <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
    <h1 style={{ color: '#B87522', fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>More</h1>
    <button
      type="button"
      onClick={() => {
        setSettingsView('menu')
        setActivePage('Settings')
      }}
      style={{
        width: '100%',
        padding: 16,
        border: '1px solid #E9D6B7',
        borderRadius: 14,
        background: '#FFFFFF',
        color: '#493320',
        textAlign: 'left',
        fontSize: 15,
        cursor: 'pointer'
      }}
    >
      Settings
      <span style={{ float: 'right', color: '#B87522' }}>›</span>
    </button>
    <button
      type="button"
      onClick={() => setActivePage('Ask Honey')}
      style={{
        width: '100%',
        marginTop: 10,
        padding: 16,
        border: '1px solid #E9D6B7',
        borderRadius: 14,
        background: '#FFFFFF',
        color: '#493320',
        textAlign: 'left',
        fontSize: 15,
        cursor: 'pointer'
      }}
    >
      Ask Honey
      <span style={{ float: 'right', color: '#B87522' }}>›</span>
    </button>
    <button
      type="button"
      onClick={() => setActivePage('Reports')}
      style={{
        width: '100%',
        marginTop: 10,
        padding: 16,
        border: '1px solid #E9D6B7',
        borderRadius: 14,
        background: '#FFFFFF',
        color: '#493320',
        textAlign: 'left',
        fontSize: 15,
        cursor: 'pointer'
      }}
    >
      Reports
      <span style={{ float: 'right', color: '#B87522' }}>›</span>
    </button>
    <section style={{
      marginTop: 10,
      padding: 14,
      border: '1px solid #E9D6B7',
      borderRadius: 14,
      background: '#FFF8ED',
      color: '#79502A'
    }}>
      <h2 style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        margin: '0 0 8px',
        color: '#493320',
        fontSize: 15
      }}>
        <span aria-hidden="true" style={{ color: '#B87522' }}>ⓘ</span>
        Financial Disclaimer
      </h2>
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
        Money Honey&apos;s financial forecasts, daily spending allowances, Smart Budgets, and automated suggestions are estimates based on the information you enter.
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.5 }}>
        Actual balances, payments, and expenses may differ. Predictions may improve as you use the app and build a more complete financial history, but accuracy is never guaranteed.
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 11, lineHeight: 1.5 }}>
        Always verify important financial decisions against your bank accounts and actual bills.
      </p>
      <p style={{ margin: '10px 0 0', color: '#9A7652', fontSize: 10, lineHeight: 1.45 }}>
        Money Honey does not automatically verify your bank balances or transactions.
      </p>
    </section>
  </main>
) : (
  <main style={{
    maxWidth: 460,
    margin: 'auto',
    minHeight: '65vh',
    padding: '30px 10px',
    textAlign: 'center'
  }}>
    <h1 style={{
      fontFamily: 'Georgia, serif',
      color: '#B87522'
    }}>
      {activePage === 'Ask Honey' ? '🐝 Ask Honey' : activePage}
    </h1>
    <p style={{ color: '#79502A' }}>
      Your {activePage} page is coming together! 🍯
    </p>
  </main>
)}



<nav style={{
  position: 'fixed',
  left: 24,
  right: 24,
  bottom: 'env(safe-area-inset-bottom)',
  zIndex: 15,
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  background: '#FFF3DF',
  borderTop: '1px solid #E9D6B7',
  borderRadius: 18,
  padding: '16px 8px',
  marginTop: 0,
  gap: 4,
  fontFamily: 'Arial, sans-serif'
}}>
  {[
    ['🏠', 'Home'],
    ['💰', 'Accounts'],
    ['📅', 'Bills'],
    ['📊', 'Budgets'],
    ['💳', 'Debt'],
    ['⚙️', 'More']
  ].map(([symbol, label]) => (
<div
  key={label}
  className={activePage === label ? 'theme-nav-item-active' : 'theme-nav-item'}
  onClick={() => setActivePage(label)}
  style={{
      flex: 1,
      textAlign: 'center',
      fontSize: 12,
      cursor: 'pointer',
      fontWeight: activePage === label ? 'bold' : 'normal'
    }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>
        {symbol}
      </div>
      {label}
    </div>
  ))}
</nav>

    </div>
  )
}

export default App
