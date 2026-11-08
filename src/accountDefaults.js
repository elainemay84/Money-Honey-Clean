export const startingAccounts = [
  { id: 1, name: 'Everyday Checking', type: 'Checking', openingBalance: 1500, openingDate: '2026-11-06', color: '#B87522', defaultCleared: false, archived: false },
  { id: 2, name: 'Savings', type: 'Savings', openingBalance: 500, openingDate: '2026-11-06', color: '#6E9A72', defaultCleared: false, archived: false },
]

export const startingTransactions = [
  { id: 1, sequence: 1, accountId: 1, name: 'Paycheck', amount: 1500, date: '2026-11-06', cleared: true },
  { id: 2, sequence: 2, accountId: 1, name: 'Groceries', amount: -125, date: '2026-11-06', cleared: true },
  { id: 3, sequence: 3, accountId: 1, name: 'Electric Bill', amount: -128, date: '2026-11-07', cleared: false },
  { id: 4, sequence: 4, accountId: 1, name: 'Gas', amount: -60, date: '2026-11-08', cleared: false },
]
