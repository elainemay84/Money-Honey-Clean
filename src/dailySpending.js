import { getBudgetSpendingEntries } from './budgetData.js'
import { netSpending } from './transactionRules.js'

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function daysBetweenInclusive(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  return Math.floor((end - start) / 86400000) + 1
}

export function calculateDailySpending({
  transactions = [],
  today,
  forecast,
  categories = [],
  budgets = {}
}) {
  const entries = getBudgetSpendingEntries({ transactions, categories })
  const spendingIn = predicate => netSpending(entries.filter(predicate)).totalCents / 100
  const todaySpending = spendingIn(entry => entry.date === today)

  const historyStart = addDays(today, -29)
  const inHistory = entry => entry.date >= historyStart && entry.date <= today
  const historicalDates = new Set(entries.filter(entry => entry.kind === 'purchase' && inHistory(entry)).map(entry => entry.date))
  const averageDailySpending = historicalDates.size >= 3 ? spendingIn(inHistory) / 30 : null

  const budgetTotal = Object.values(budgets).reduce((total, amount) => {
    const value = Number(amount)
    return Number.isFinite(value) && value >= 0 ? total + value : total
  }, 0)
  const currentMonth = today.slice(0, 7)
  const currentMonthSpending = spendingIn(entry => entry.date?.slice(0, 7) === currentMonth)
  const remainingBudget = Object.keys(budgets).length
    ? Math.max(0, budgetTotal - currentMonthSpending)
    : null
  const forecastDays = forecast?.endDate
    ? daysBetweenInclusive(forecast.startDate ?? today, forecast.endDate)
    : 0
  const projectedFunds = Number(forecast?.projectedRemainingFunds)
  const hasForecast = forecast?.hasIncomeSchedule === true
    && Number.isFinite(projectedFunds)
    && forecastDays > 0
  const forecastPool = hasForecast ? projectedFunds + todaySpending : null
  const budgetPool = remainingBudget == null ? null : remainingBudget + todaySpending
  const rawDiscretionaryFunds = hasForecast
    ? budgetPool == null ? forecastPool : Math.min(forecastPool, budgetPool)
    : null
  const safetyCapacity = Number(forecast?.cashFlowSafety?.safetyCapacity)
  const discretionaryFunds = rawDiscretionaryFunds == null
    ? null
    : Number.isFinite(safetyCapacity)
      ? Math.min(rawDiscretionaryFunds, safetyCapacity)
      : rawDiscretionaryFunds
  const futureDatedTransactions = transactions
    .filter(transaction =>
      transaction.date > today
      && (!forecast?.endDate || transaction.date <= forecast.endDate)
    )
    .reduce((total, transaction) => total + Number(transaction.amount || 0), 0)
  const constraint = discretionaryFunds == null
    ? 'Not enough information to calculate a safe allowance.'
    : Number.isFinite(safetyCapacity) && safetyCapacity < rawDiscretionaryFunds
      ? 'Cash-flow safety is limiting the allowance so upcoming obligations remain covered.'
      : budgetPool != null && budgetPool < forecastPool
        ? 'Remaining approved budgets are limiting the allowance.'
        : 'No additional constraint is limiting the allowance.'
  const limitingAmount = discretionaryFunds == null
    ? null
    : Number.isFinite(safetyCapacity) && safetyCapacity < rawDiscretionaryFunds
      ? safetyCapacity
      : budgetPool != null && budgetPool < forecastPool
        ? budgetPool
        : forecastPool

  return {
    suggestedDailyLimit: discretionaryFunds == null ? null : discretionaryFunds / 30,
    averageDailySpending,
    todaySpending,
    remainingToday: discretionaryFunds == null ? null : discretionaryFunds / 30 - todaySpending,
    forecastDays: hasForecast ? 30 : 0,
    remainingBudget,
    hasForecast,
    explanation: {
      currentAvailableFunds: Number.isFinite(Number(forecast?.availableFunds))
        ? Number(forecast.availableFunds)
        : null,
      totalProjectedFunds: Number.isFinite(Number(forecast?.projectedRemainingFunds))
        ? Number(forecast.projectedRemainingFunds)
        : null,
      expectedIncome: Number.isFinite(Number(forecast?.upcomingIncome))
        ? Number(forecast.upcomingIncome)
        : null,
      upcomingBills: Number.isFinite(Number(forecast?.scheduledBills))
        ? Number(forecast.scheduledBills)
        : null,
      futureDatedTransactions,
      reservedForBudgets: remainingBudget,
      forecastDiscretionaryPool: forecastPool,
      budgetLimitedPool: budgetPool,
      cashFlowSafetyCapacity: Number.isFinite(safetyCapacity) ? safetyCapacity : null,
      finalDiscretionaryPool: discretionaryFunds,
      protectedFunds: forecastPool != null && discretionaryFunds != null
        ? Math.max(0, forecastPool - discretionaryFunds)
        : null,
      limitingAmount,
      lowestProjectedBalance: Number.isFinite(Number(forecast?.cashFlowSafety?.lowestProjectedBalance))
        ? Number(forecast.cashFlowSafety.lowestProjectedBalance)
        : null,
      lowestProjectedAccountName: forecast?.cashFlowSafety?.lowestProjectedAccountName ?? null,
      lowestProjectedBalanceDate: forecast?.cashFlowSafety?.lowestProjectedBalanceDate ?? null,
      finalSuggestedDailyAllowance: discretionaryFunds == null ? null : discretionaryFunds / 30,
      limitingConstraint: constraint
    }
  }
}
