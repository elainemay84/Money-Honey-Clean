import { calculateAccountBalances } from './accountBalances.js'
import {
  getOutstandingBillOccurrences,
  getIncomeOccurrencesInRange,
  getPaySchedulePeriod
} from './billData.js'
import { getDebtForecastBills } from './debtData.js'

const FORECAST_HORIZON_DAYS = 731

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function isSpendingAccount(account) {
  const type = String(account.type ?? 'Other').toLowerCase()
  return !account.archived
    && ['checking', 'savings', 'cash', 'other'].includes(type)
}

function sumAmounts(items) {
  return items.reduce((total, item) => total + Math.round(Number(item.amount || 0) * 100), 0) / 100
}

function getAvailableFunds(accounts, transactions, today) {
  return Math.round(accounts
    .filter(isSpendingAccount)
    .reduce((total, account) => {
      const accountTransactions = transactions.filter(
        transaction => transaction.accountId === account.id && transaction.date <= today
      )
      const balance = calculateAccountBalances(
        Number(account.openingBalance || 0),
        accountTransactions,
        'asc',
        account.openingDate ?? '0000-01-01'
      )
      return total + Math.round(balance.available * 100)
    }, 0)) / 100
}

function belongsToForecast(occurrence, accounts) {
  return occurrence.accountId == null || accounts.some(account => account.id === occurrence.accountId)
}

function isIncludedTransaction(transaction, accounts, endDate) {
  const account = accounts.find(account => account.id === transaction.accountId)
  return Boolean(account && transaction.date >= (account.openingDate ?? '0000-01-01')
    && transaction.date <= endDate)
}

function unrepresentedBillAmount(occurrence, accounts, endDate) {
  const transaction = occurrence.linkedTransaction
  const reflected = transaction && isIncludedTransaction(transaction, accounts, endDate)
    ? Math.max(0, -transaction.amount) : 0
  return Math.max(0, Math.round((Math.abs(occurrence.amount) - reflected) * 100)) / 100
}

function isAllowanceAccount(account) {
  const type = String(account.type ?? '').toLowerCase()
  return type.includes('checking') || type.includes('cash') || type === 'other'
}

export function calculateCashFlowSafety({
  accounts = [],
  transactions = [],
  bills = [],
  incomes = [],
  today,
  forecastEndDate
}) {
  if (!forecastEndDate) return null
  const spendingAccounts = accounts.filter(isSpendingAccount)
  if (!spendingAccounts.length) return null
  const activeIncomeSchedules = incomes.filter(income =>
    !income.archived && income.active !== false
  )
  const incomeOccurrences = getIncomeOccurrencesInRange(
    activeIncomeSchedules,
    today,
    forecastEndDate,
    transactions
  )
  const billOccurrences = getOutstandingBillOccurrences(
    bills,
    today,
    forecastEndDate,
    transactions
  )
  const accountBalances = new Map()
  const events = new Map()

  for (const account of spendingAccounts) {
    const openingDate = account.openingDate ?? '0000-01-01'
    const balance = Number(account.openingBalance || 0) + transactions
      .filter(transaction =>
        transaction.accountId === account.id
        && transaction.date >= openingDate
        && transaction.date <= today
      )
      .reduce((total, transaction) => total + Number(transaction.amount || 0), 0)
    accountBalances.set(account.id, balance)
  }

  function addEvent(date, accountId, amount, priority, sequence = 0) {
    if (!accountBalances.has(accountId)) return
    if (!events.has(date)) events.set(date, [])
    events.get(date).push({ accountId, amount, priority, sequence })
  }

  for (const transaction of transactions) {
    if (transaction.date > today && isIncludedTransaction(transaction, spendingAccounts, forecastEndDate)) {
      addEvent(transaction.date, transaction.accountId, Number(transaction.amount || 0), 1, transaction.sequence ?? transaction.id)
    }
  }
  for (const occurrence of billOccurrences) {
    if (!occurrence.skipped) {
      const amount = unrepresentedBillAmount(occurrence, spendingAccounts, forecastEndDate)
      addEvent(occurrence.dueDate < today ? today : occurrence.dueDate, occurrence.accountId, -amount, 0)
    }
  }
  for (const occurrence of incomeOccurrences) {
    if (!occurrence.linkedTransaction && !occurrence.legacyReceived) {
      addEvent(occurrence.dueDate, occurrence.accountId, Math.abs(occurrence.amount), 2)
    }
  }

  const minimumBalances = new Map(accountBalances)
  const minimumBalanceDates = new Map(
    [...accountBalances.keys()].map(accountId => [accountId, today])
  )
  const dates = [...events.keys()].sort()
  for (const date of dates) {
    const dateEvents = [...events.get(date)].sort((a, b) =>
      a.priority - b.priority || a.sequence - b.sequence
    )
    for (const event of dateEvents) {
      const nextBalance = accountBalances.get(event.accountId) + event.amount
      accountBalances.set(event.accountId, nextBalance)
      const previousMinimum = minimumBalances.get(event.accountId)
      minimumBalances.set(event.accountId, Math.min(previousMinimum, nextBalance))
      if (nextBalance < previousMinimum) {
        minimumBalanceDates.set(event.accountId, date)
      }
    }
  }

  const minimumValues = [...minimumBalances.values()]
  const hasNegativeBalance = minimumValues.some(balance => balance < 0)
  const allowanceBalances = spendingAccounts
    .filter(isAllowanceAccount)
    .map(account => minimumBalances.get(account.id))
  const unassignedBills = billOccurrences.filter(occurrence =>
    occurrence.accountId == null && !occurrence.skipped
  ).map(occurrence => ({
    amount: unrepresentedBillAmount(occurrence, spendingAccounts, forecastEndDate)
  }))
  const safetyCapacity = hasNegativeBalance
    ? 0
    : Math.max(0, allowanceBalances.reduce((total, balance) => total + Math.max(0, balance), 0)
      - sumAmounts(unassignedBills))

  const lowestAccount = [...minimumBalances.entries()]
    .sort(([, first], [, second]) => first - second)[0]?.[0]
  const lowestAccountDetails = spendingAccounts.find(account => account.id === lowestAccount)
  return {
    minimumBalances: Object.fromEntries(minimumBalances),
    lowestProjectedBalance: Math.min(...minimumValues),
    lowestProjectedAccountId: lowestAccount ?? null,
    lowestProjectedAccountName: lowestAccountDetails?.name ?? null,
    lowestProjectedBalanceDate: lowestAccount == null
      ? null
      : minimumBalanceDates.get(lowestAccount) ?? null,
    safetyCapacity
  }
}

export function calculatePaycheckForecast({
  accounts = [],
  transactions = [],
  bills = [],
  debts = [],
  incomes = [],
  paySchedule = null,
  today,
  forecastEndDate
}) {
  const spendingAccounts = accounts.filter(isSpendingAccount)
  const forecastBills = getDebtForecastBills(bills, debts)
  const activeIncomeSchedules = incomes.filter(income =>
    !income.archived && income.active !== false
  )
  const searchEndDate = addDays(today, FORECAST_HORIZON_DAYS)
  const incomeSearch = getIncomeOccurrencesInRange(
    activeIncomeSchedules,
    today,
    searchEndDate,
    transactions
  ).filter(occurrence => belongsToForecast(occurrence, spendingAccounts))
  const nextPayday = getPaySchedulePeriod(paySchedule, today)?.endDate
    ?? incomeSearch.find(occurrence => occurrence.dueDate >= today)?.dueDate ?? null
  const endpoint = forecastEndDate ?? nextPayday
  const availableFunds = getAvailableFunds(spendingAccounts, transactions, today)
  const cashFlowSafety = calculateCashFlowSafety({
    accounts,
    transactions,
    bills: forecastBills,
    incomes: activeIncomeSchedules,
    today,
    forecastEndDate: endpoint
  })

  if (!endpoint) {
    return {
      hasIncomeSchedule: activeIncomeSchedules.length > 0,
      nextPayday: null,
      startDate: today,
      endDate: null,
      availableFunds,
      upcomingIncome: 0,
      nextPaydayIncome: 0,
      scheduledBills: 0,
      projectedRemainingFunds: availableFunds,
      cashFlowSafety
    }
  }

  const incomeOccurrences = getIncomeOccurrencesInRange(
    activeIncomeSchedules,
    today,
    endpoint,
    transactions
  )
  const futureTransactions = transactions.filter(transaction =>
    transaction.date > today && isIncludedTransaction(transaction, spendingAccounts, endpoint)
  )
  const expectedIncome = incomeOccurrences.filter(occurrence =>
    !occurrence.linkedTransaction && !occurrence.legacyReceived
    && belongsToForecast(occurrence, spendingAccounts)
  )
  const upcomingIncome = sumAmounts([
    ...futureTransactions.filter(transaction => transaction.amount > 0),
    ...expectedIncome
  ])
  const nextPaydayIncome = sumAmounts([
    ...futureTransactions.filter(transaction => transaction.amount > 0 && transaction.date === nextPayday),
    ...expectedIncome.filter(occurrence => occurrence.dueDate === nextPayday)
  ])
  const billOccurrences = getOutstandingBillOccurrences(forecastBills, today, endpoint, transactions)
  const scheduledBills = sumAmounts([
    ...futureTransactions.filter(transaction => transaction.amount < 0)
      .map(transaction => ({ amount: -transaction.amount })),
    ...billOccurrences.filter(occurrence =>
      !occurrence.skipped && belongsToForecast(occurrence, spendingAccounts)
    ).map(occurrence => ({ amount: unrepresentedBillAmount(occurrence, spendingAccounts, endpoint) }))
  ])

  return {
    hasIncomeSchedule: activeIncomeSchedules.length > 0,
    nextPayday,
    startDate: today,
    endDate: endpoint,
    availableFunds,
    upcomingIncome,
    nextPaydayIncome,
    scheduledBills,
    projectedRemainingFunds: Math.round((availableFunds + upcomingIncome - scheduledBills) * 100) / 100,
    cashFlowSafety
  }
}
