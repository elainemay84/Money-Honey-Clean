import { calculateAccountBalances } from './accountBalances.js'
import {
  getBillOccurrencesInRange,
  getIncomeOccurrencesInRange,
  isBillOccurrencePaid
} from './billData.js'

const FORECAST_HORIZON_DAYS = 731

function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

function isSpendingAccount(account) {
  const type = String(account.type ?? '').toLowerCase()
  return !account.archived
    && !type.includes('credit')
    && !type.includes('debt')
}

function sumAmounts(items) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0)
}

function getAvailableFunds(accounts, transactions) {
  return accounts
    .filter(isSpendingAccount)
    .reduce((total, account) => {
      const accountTransactions = transactions.filter(
        transaction => transaction.accountId === account.id
      )
      const balance = calculateAccountBalances(
        Number(account.openingBalance || 0),
        accountTransactions,
        'asc',
        account.openingDate ?? '0000-01-01'
      )
      return total + balance.available
    }, 0)
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
  const billOccurrences = getBillOccurrencesInRange(
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
    if (transaction.date > today && transaction.date <= forecastEndDate) {
      addEvent(transaction.date, transaction.accountId, Number(transaction.amount || 0), 1, transaction.sequence ?? transaction.id)
    }
  }
  for (const occurrence of billOccurrences) {
    if (!isBillOccurrencePaid(occurrence) && !occurrence.skipped) {
      addEvent(occurrence.dueDate, occurrence.accountId, -Math.abs(occurrence.amount), 0)
    }
  }
  for (const occurrence of incomeOccurrences) {
    if (!occurrence.transactionId && !occurrence.linkedTransaction) {
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
  const safetyCapacity = hasNegativeBalance
    ? 0
    : allowanceBalances.reduce((total, balance) => total + Math.max(0, balance), 0)

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
  incomes = [],
  today,
  forecastEndDate
}) {
  const activeIncomeSchedules = incomes.filter(income =>
    !income.archived && income.active !== false
  )
  const searchEndDate = addDays(today, FORECAST_HORIZON_DAYS)
  const incomeSearch = getIncomeOccurrencesInRange(
    activeIncomeSchedules,
    today,
    searchEndDate,
    transactions
  )
  const nextPayday = incomeSearch.find(occurrence => occurrence.dueDate >= today)?.dueDate ?? null
  const endpoint = forecastEndDate ?? nextPayday
  const availableFunds = getAvailableFunds(accounts, transactions)
  const cashFlowSafety = calculateCashFlowSafety({
    accounts,
    transactions,
    bills,
    incomes,
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
  const upcomingIncome = sumAmounts(incomeOccurrences.filter(occurrence =>
    !occurrence.transactionId && !occurrence.linkedTransaction
  ))
  const nextPaydayIncome = sumAmounts(incomeOccurrences.filter(occurrence =>
    occurrence.dueDate === nextPayday
      && !occurrence.transactionId
      && !occurrence.linkedTransaction
  ))
  const billOccurrences = getBillOccurrencesInRange(bills, today, endpoint, transactions)
  const scheduledBills = sumAmounts(billOccurrences.filter(occurrence =>
    !isBillOccurrencePaid(occurrence) && !occurrence.skipped
  ))

  return {
    hasIncomeSchedule: activeIncomeSchedules.length > 0,
    nextPayday,
    startDate: today,
    endDate: endpoint,
    availableFunds,
    upcomingIncome,
    nextPaydayIncome,
    scheduledBills,
    projectedRemainingFunds: availableFunds + upcomingIncome - scheduledBills,
    cashFlowSafety
  }
}
