function compareTransactions(a, b) {
  return a.date.localeCompare(b.date)
    || (a.sequence ?? a.id) - (b.sequence ?? b.id)
    || a.id - b.id
}

function nextTransactionSequence(transactions) {
  return transactions.reduce(
    (nextSequence, transaction) => Math.max(nextSequence, transaction.sequence ?? transaction.id),
    0
  ) + 1
}

export function getNextTransactionSequence(transactions, lastSequence = 0) {
  return Math.max(lastSequence, nextTransactionSequence(transactions) - 1) + 1
}

export function moveTransactionToDate(transactions, id, date, sequence = nextTransactionSequence(transactions)) {
  const transaction = transactions.find(item => item.id === id)
  if (!transaction || transaction.date === date) return transactions

  return transactions.map(item =>
    item.id === id ? { ...item, date, sequence } : item
  )
}

export function normalizeTransactionAmount(amount, kind) {
  return kind === 'expense' ? -Math.abs(amount) : Math.abs(amount)
}

export function calculateAccountBalances(
  openingBalance,
  transactions,
  sortOrder = 'asc',
  referenceDate = '0000-01-01'
) {
  const sortedTransactions = [...transactions].sort(compareTransactions)
  const referenceIndex = sortedTransactions.findIndex(
    transaction => transaction.date >= referenceDate
  )
  const forwardStart = referenceIndex < 0 ? sortedTransactions.length : referenceIndex
  const chronologicalRows = sortedTransactions.map(transaction => ({
    ...transaction,
    runningBalance: openingBalance
  }))

  let runningBalance = openingBalance
  for (let index = forwardStart; index < sortedTransactions.length; index += 1) {
    runningBalance += sortedTransactions[index].amount
    chronologicalRows[index].runningBalance = runningBalance
  }

  runningBalance = openingBalance
  for (let index = forwardStart - 1; index >= 0; index -= 1) {
    chronologicalRows[index].runningBalance = runningBalance
    runningBalance -= sortedTransactions[index].amount
  }

  const includedTransactions = transactions.filter(
    transaction => transaction.date >= referenceDate
  )

  const clearedBalance = includedTransactions
    .filter(transaction => transaction.cleared)
    .reduce((balance, transaction) => balance + transaction.amount, openingBalance)

  const projectedBalance = includedTransactions
    .reduce((balance, transaction) => balance + transaction.amount, openingBalance)

  const unclearedBalance = includedTransactions
    .filter(transaction => !transaction.cleared)
    .reduce((balance, transaction) => balance + transaction.amount, 0)

  const rows = sortOrder === 'desc'
    ? [...chronologicalRows].reverse()
    : chronologicalRows

  return {
    chronologicalRows,
    rows,
    balance: clearedBalance,
    available: projectedBalance,
    unclearedBalance,
    clearedBalance,
    projectedBalance
  }
}
