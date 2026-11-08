export const ACCOUNT_STORAGE_KEY = 'money-honey-account-data'
export const ACCOUNT_STORAGE_VERSION = 1

function assertAccountData(data) {
  if (!data || !Array.isArray(data.accounts) || !Array.isArray(data.transactions)) {
    throw new Error('Saved Money Honey account data is invalid.')
  }
}

export function saveAccountData(accounts, transactions, storage = localStorage) {
  const data = {
    version: ACCOUNT_STORAGE_VERSION,
    accounts,
    transactions
  }
  storage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(data))
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('money-honey-accounts-updated'))
  }
}

export function loadAccountData(defaultAccounts, defaultTransactions, storage = localStorage) {
  const savedData = storage.getItem(ACCOUNT_STORAGE_KEY)
  if (savedData === null) {
    saveAccountData(defaultAccounts, defaultTransactions, storage)
    return { accounts: defaultAccounts, transactions: defaultTransactions }
  }

  let data
  try {
    data = JSON.parse(savedData)
  } catch (error) {
    throw new Error('Saved Money Honey account data could not be read.', { cause: error })
  }

  assertAccountData(data)
  return { accounts: data.accounts, transactions: data.transactions }
}

export function loadSavedAccountData(storage = localStorage) {
  const savedData = storage.getItem(ACCOUNT_STORAGE_KEY)
  if (savedData === null) return null

  let data
  try {
    data = JSON.parse(savedData)
  } catch (error) {
    throw new Error('Saved Money Honey account data could not be read.', { cause: error })
  }
  assertAccountData(data)
  return { accounts: data.accounts, transactions: data.transactions }
}

function getOccurrenceLinkFields(flow, occurrenceId) {
  return flow === 'out'
    ? { linkedOccurrenceType: 'bill', linkedOccurrenceId: occurrenceId, linkedBillOccurrenceId: occurrenceId }
    : { linkedOccurrenceType: 'income', linkedOccurrenceId: occurrenceId, linkedIncomeOccurrenceId: occurrenceId }
}

export function getLinkedOccurrenceTransaction(transactions, flow, occurrence) {
  const occurrenceId = occurrence.occurrenceId
  const legacyIncomeLink = flow === 'in' ? `${occurrence.id}:${occurrence.scheduledDate ?? occurrence.dueDate}` : null
  return transactions.find(transaction =>
    (transaction.linkedOccurrenceType === (flow === 'out' ? 'bill' : 'income')
      && transaction.linkedOccurrenceId === occurrenceId)
    || (flow === 'out' && transaction.linkedBillOccurrenceId === occurrenceId)
    || (flow === 'in' && transaction.linkedIncomeOccurrenceId === legacyIncomeLink)
    || (flow === 'in' && transaction.linkedIncomeOccurrenceId === occurrenceId)
    || (
      occurrence.transactionId === transaction.id
      && !transaction.unlinkedOccurrenceIds?.includes(occurrenceId)
      && !transaction.unlinkedOccurrenceIds?.includes(legacyIncomeLink)
      && (!transaction.linkedOccurrenceId || transaction.linkedOccurrenceId === occurrenceId)
      && (!transaction.linkedOccurrenceType || transaction.linkedOccurrenceType === (flow === 'out' ? 'bill' : 'income'))
      && (!transaction.linkedBillOccurrenceId || transaction.linkedBillOccurrenceId === occurrenceId)
      && (!transaction.linkedIncomeOccurrenceId || transaction.linkedIncomeOccurrenceId === legacyIncomeLink || transaction.linkedIncomeOccurrenceId === occurrenceId)
    )
  ) ?? null
}

function readAccountDataForMutation(storage) {
  const data = loadSavedAccountData(storage)
  if (!data) throw new Error('No saved account is available for this occurrence.')
  return data
}

export function createOccurrenceTransaction(flow, occurrence, actualDate, storage = localStorage) {
  if (!occurrence.accountId) throw new Error('Choose an associated account before recording this occurrence.')
  if (!actualDate) throw new Error('Choose the actual payment or received date.')
  const data = readAccountDataForMutation(storage)
  const occurrenceId = occurrence.occurrenceId
  const existing = getLinkedOccurrenceTransaction(data.transactions, flow, occurrence)
  if (existing) return { status: 'linked', transaction: existing }

  const account = data.accounts.find(item => item.id === occurrence.accountId && !item.archived)
  if (!account) throw new Error('The associated account is unavailable or archived.')

  const matches = data.transactions.filter(transaction =>
    transaction.accountId === occurrence.accountId
    && transaction.amount === (flow === 'out' ? -Math.abs(occurrence.amount) : Math.abs(occurrence.amount))
    && !transaction.linkedOccurrenceId
    && !transaction.linkedBillOccurrenceId
    && !transaction.linkedIncomeOccurrenceId
    && (
      (
        transaction.name.trim().toLocaleLowerCase() === occurrence.name.trim().toLocaleLowerCase()
        && transaction.date === actualDate
      )
      || transaction.unlinkedOccurrenceIds?.includes(occurrenceId)
      || transaction.unlinkedOccurrenceIds?.includes(`${occurrence.id}:${occurrence.scheduledDate ?? occurrence.dueDate}`)
    )
  )
  if (matches.length) return { status: 'matches', transactions: matches }

  const id = data.transactions.reduce((max, transaction) => Math.max(max, transaction.id), 0) + 1
  const sequence = data.transactions.reduce(
    (max, transaction) => Math.max(max, transaction.sequence ?? transaction.id),
    0
  ) + 1
  const linkedFields = getOccurrenceLinkFields(flow, occurrenceId)
  const transaction = {
    id,
    sequence,
    accountId: occurrence.accountId,
    name: occurrence.name,
    amount: flow === 'out' ? -Math.abs(occurrence.amount) : Math.abs(occurrence.amount),
    date: actualDate,
    cleared: false,
    ...linkedFields
  }
  data.transactions.push(transaction)
  saveAccountData(data.accounts, data.transactions, storage)
  return { status: 'created', transaction }
}

export function linkExistingOccurrenceTransaction(flow, occurrence, transactionId, storage = localStorage) {
  const data = readAccountDataForMutation(storage)
  const transaction = data.transactions.find(item => item.id === transactionId)
  if (!transaction) throw new Error('The selected account transaction is unavailable.')

  const signedAmount = flow === 'out' ? -Math.abs(occurrence.amount) : Math.abs(occurrence.amount)
  if (transaction.accountId !== occurrence.accountId || transaction.amount !== signedAmount) {
    throw new Error('The selected transaction does not match this occurrence account and amount.')
  }
  const existingLink = getLinkedOccurrenceTransaction(data.transactions, flow, occurrence)
  if (existingLink && existingLink.id !== transactionId) {
    throw new Error('This occurrence is already linked to a different transaction.')
  }
  const isAlreadyLinked = transaction.linkedOccurrenceId
    || transaction.linkedBillOccurrenceId
    || transaction.linkedIncomeOccurrenceId
  if (isAlreadyLinked) {
    if (getLinkedOccurrenceTransaction([transaction], flow, occurrence)) return transaction
    throw new Error('This account transaction is already linked to another occurrence.')
  }

  transaction.unlinkedOccurrenceIds = (transaction.unlinkedOccurrenceIds ?? [])
    .filter(id => id !== occurrence.occurrenceId && id !== `${occurrence.id}:${occurrence.scheduledDate ?? occurrence.dueDate}`)
  Object.assign(transaction, getOccurrenceLinkFields(flow, occurrence.occurrenceId))
  saveAccountData(data.accounts, data.transactions, storage)
  return transaction
}

export function setOccurrenceTransactionCleared(transactionId, cleared, storage = localStorage) {
  const data = readAccountDataForMutation(storage)
  const transaction = data.transactions.find(item => item.id === transactionId)
  if (!transaction) throw new Error('The linked account transaction no longer exists.')
  if (transaction.cleared !== cleared) {
    transaction.cleared = cleared
    saveAccountData(data.accounts, data.transactions, storage)
  }
  return transaction
}

export function unlinkOccurrenceTransaction(transactionId, storage = localStorage) {
  const data = readAccountDataForMutation(storage)
  const transaction = data.transactions.find(item => item.id === transactionId)
  if (!transaction) throw new Error('The linked account transaction no longer exists.')
  const occurrenceId = transaction.linkedOccurrenceId
    ?? transaction.linkedBillOccurrenceId
    ?? transaction.linkedIncomeOccurrenceId
  if (occurrenceId) {
    transaction.unlinkedOccurrenceIds = [...new Set([
      ...(transaction.unlinkedOccurrenceIds ?? []),
      occurrenceId
    ])]
  }
  delete transaction.linkedOccurrenceType
  delete transaction.linkedOccurrenceId
  delete transaction.linkedBillOccurrenceId
  delete transaction.linkedIncomeOccurrenceId
  delete transaction.legacyLinkedIncomeOccurrenceId
  saveAccountData(data.accounts, data.transactions, storage)
  return transaction
}

export function removeOccurrenceTransaction(flow, occurrence, storage = localStorage) {
  const data = readAccountDataForMutation(storage)
  const transaction = getLinkedOccurrenceTransaction(data.transactions, flow, occurrence)
  if (!transaction) throw new Error('The linked account transaction no longer exists.')

  data.transactions = data.transactions.filter(item => item.id !== transaction.id)
  saveAccountData(data.accounts, data.transactions, storage)
  return transaction
}

export function updateOccurrenceTransaction(transactionId, changes, storage = localStorage) {
  return updateOccurrenceTransactions([transactionId], changes, storage)[0]
}

export function updateOccurrenceTransactions(transactionIds, changes, storage = localStorage) {
  const data = readAccountDataForMutation(storage)
  const transactions = transactionIds.map(transactionId =>
    data.transactions.find(item => item.id === transactionId)
  )
  if (transactions.some(transaction => !transaction)) {
    throw new Error('A linked account transaction no longer exists.')
  }
  if (
    changes.accountId != null
    && !data.accounts.some(account => account.id === changes.accountId && !account.archived)
  ) {
    throw new Error('The selected account is unavailable or archived.')
  }
  let nextSequence = data.transactions.reduce(
    (max, transaction) => Math.max(max, transaction.sequence ?? transaction.id),
    0
  ) + 1
  for (const transaction of transactions) {
    const dateChanged = changes.date && changes.date !== transaction.date
    Object.assign(transaction, changes)
    if (dateChanged) transaction.sequence = nextSequence++
  }
  saveAccountData(data.accounts, data.transactions, storage)
  return transactions
}
