function compareTransactions(a, b) {
  return a.date.localeCompare(b.date) || a.id - b.id
}

export function normalizeTransactionAmount(amount, kind) {
  return kind === 'expense' ? -Math.abs(amount) : Math.abs(amount)
}

export function calculateAccountBalances(openingBalance, transactions, sortOrder = 'asc') {
  const chronologicalRows = [...transactions]
    .sort(compareTransactions)
    .reduce((rows, transaction) => {
      const previousBalance = rows.length
        ? rows[rows.length - 1].runningBalance
        : openingBalance

      rows.push({
        ...transaction,
        runningBalance: previousBalance + transaction.amount
      })
      return rows
    }, [])

  const clearedBalance = transactions
    .filter(transaction => transaction.cleared)
    .reduce((balance, transaction) => balance + transaction.amount, openingBalance)

  const projectedBalance = transactions
    .reduce((balance, transaction) => balance + transaction.amount, openingBalance)

  const rows = [...chronologicalRows].sort((a, b) =>
    sortOrder === 'desc'
      ? b.date.localeCompare(a.date) || a.id - b.id
      : compareTransactions(a, b)
  )

  return { chronologicalRows, rows, clearedBalance, projectedBalance }
}
