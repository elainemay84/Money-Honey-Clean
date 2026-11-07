function compareTransactions(a, b) {
  return a.date.localeCompare(b.date)
    || (a.order ?? a.id) - (b.order ?? b.id)
    || a.id - b.id
}

function nextTransactionOrder(transactions) {
  return transactions.reduce(
    (nextOrder, transaction) => Math.max(nextOrder, transaction.order ?? transaction.id),
    0
  ) + 1
}

export function moveTransactionToDate(transactions, id, date) {
  const transaction = transactions.find(item => item.id === id)
  if (!transaction || transaction.date === date) return transactions

  const order = nextTransactionOrder(transactions)
  return transactions.map(item =>
    item.id === id ? { ...item, date, order } : item
  )
}

export function reorderTransactionWithinDate(transactions, id, direction) {
  const transaction = transactions.find(item => item.id === id)
  if (!transaction) return transactions

  const sameDate = transactions
    .filter(item => item.date === transaction.date)
    .sort(compareTransactions)
  const index = sameDate.findIndex(item => item.id === id)
  const neighbor = sameDate[index + (direction === 'up' ? -1 : 1)]
  if (!neighbor) return transactions

  const currentOrder = transaction.order ?? transaction.id
  const neighborOrder = neighbor.order ?? neighbor.id
  return transactions.map(item => {
    if (item.id === id) return { ...item, order: neighborOrder }
    if (item.id === neighbor.id) return { ...item, order: currentOrder }
    return item
  })
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
