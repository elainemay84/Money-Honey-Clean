// One shared definition of how a recorded transaction is classified, used by Budgets, Daily Spending, and
// Reports so the same money is never treated differently in different places. Nothing here reads or writes
// storage, and no transaction is ever changed: classification produces separate records that point back to
// the originals.
//
// Kinds:
//   purchase      money out for goods or services (counted as spending, even without a category)
//   refund        money in recorded under an expense category; it reduces that category's spending
//   income        money in that is not a refund, transfer, debt payment, or credit-card credit
//   debt-payment  any transaction tied to a debt (reliable metadata), including credit card payments
//   transfer      movement between accounts
//   duplicate     a repeat link to a bill or income occurrence that was already counted
//   card-credit   money in on a Credit Card account that is not a refund (payment, reward, or unknown)
//   ignored       zero or non-numeric amount

export const UNCATEGORIZED = 'Uncategorized'
export const DEBT_PAYMENTS_CATEGORY = 'Debt Payments'

const TRANSFER_NAME = /^(transfer|payment to (credit card|debt))/i
const CARD_PAYMENT_NAME = /\b(credit card|card payment|card pmt|cc payment|amex|american express|discover|mastercard|visa)\b/i
const REFUND_NAME = /\b(refund(ed)?|return(ed)?|reimburse\w*|reversal|chargeback|cash ?back)\b/i

export const FLAG_REASONS = {
  uncategorized: 'No category. Counted under Uncategorized.',
  'unknown-category': 'Its category is no longer an active expense category. Counted under Uncategorized.',
  'possible-card-payment': 'Looks like a credit card payment but is not linked to a debt. Counted as spending until you classify it.',
  'unmatched-refund': 'A refund with no matching spending in this category this month. It is not counted as income or as spending.',
  'possible-refund': 'Counted as income, but the name suggests a refund or reimbursement.',
  'uncategorized-income': 'No category. Counted as income.',
  'card-credit': 'A credit on a credit card account (payment, refund, or reward?). Not counted as income.'
}

const toCents = amount => Math.round(Math.abs(amount) * 100)
const hasText = value => typeof value === 'string' && value.trim() !== ''

export function isTransferTransaction(transaction) {
  return transaction.type === 'transfer'
    || transaction.isTransfer === true
    || Boolean(transaction.transferId)
    || TRANSFER_NAME.test(transaction.name ?? '')
}

// Debt payments are recognized by the metadata the Debt feature writes, not by name. A payment linked from an
// existing transaction keeps its original category, so the category alone is not enough.
export function isDebtPaymentTransaction(transaction) {
  return transaction.transactionType === 'debt-payment'
    || transaction.linkedDebtId != null
    || transaction.linkedDebtPaymentId != null
    || transaction.category === DEBT_PAYMENTS_CATEGORY
}

export function classifyTransactions({ transactions, categories, accounts = [] }) {
  const activeCategories = new Set(categories)
  const cardAccounts = new Set(accounts.filter(account => account?.type === 'Credit Card').map(account => account.id))
  const seenLinks = new Set()

  return transactions.map(transaction => {
    const amount = transaction?.amount
    if (!Number.isFinite(amount) || amount === 0) {
      return { transaction, kind: 'ignored', cents: 0, signedCents: 0, date: transaction?.date, flags: [] }
    }
    const record = {
      transaction,
      cents: toCents(amount),
      signedCents: Math.round(amount * 100),
      date: transaction.date,
      flags: []
    }
    if (isTransferTransaction(transaction)) return { ...record, kind: 'transfer' }
    if (isDebtPaymentTransaction(transaction)) return { ...record, kind: 'debt-payment' }

    if (transaction.linkedOccurrenceId) {
      if (seenLinks.has(transaction.linkedOccurrenceId)) return { ...record, kind: 'duplicate' }
      seenLinks.add(transaction.linkedOccurrenceId)
    }

    const name = transaction.name ?? ''
    if (amount < 0) {
      const isActive = activeCategories.has(transaction.category)
      const flags = []
      if (!hasText(transaction.category)) flags.push('uncategorized')
      else if (!isActive) flags.push('unknown-category')
      if (CARD_PAYMENT_NAME.test(name)) flags.push('possible-card-payment')
      return { ...record, kind: 'purchase', category: isActive ? transaction.category : UNCATEGORIZED, flags }
    }

    if (activeCategories.has(transaction.category)) return { ...record, kind: 'refund', category: transaction.category }
    if (cardAccounts.has(transaction.accountId)) return { ...record, kind: 'card-credit', flags: ['card-credit'] }
    const flags = []
    if (!hasText(transaction.category)) flags.push('uncategorized-income')
    if (REFUND_NAME.test(name)) flags.push('possible-refund')
    return { ...record, kind: 'income', flags }
  })
}

// Purchases add to a category and refunds subtract from it.
export function getSpendingEntries(classified) {
  return classified
    .filter(record => record.kind === 'purchase' || record.kind === 'refund')
    .map(record => ({
      category: record.category,
      date: record.date,
      kind: record.kind,
      cents: record.kind === 'purchase' ? record.cents : -record.cents,
      transaction: record.transaction
    }))
}

// Net spending for a set of entries (one month, one day, ...). Each category is floored at zero, so a refund
// larger than that category's spending in the window never shows as negative spending; the excess is reported
// as unmatched instead of being guessed at.
export function netSpending(entries) {
  const purchases = new Map()
  const refunds = new Map()
  for (const entry of entries) {
    const target = entry.kind === 'purchase' ? purchases : refunds
    target.set(entry.category, (target.get(entry.category) ?? 0) + Math.abs(entry.cents))
  }
  const byCategory = {}
  const unmatchedCategories = []
  let totalCents = 0
  let appliedRefundCents = 0
  let unmatchedRefundCents = 0
  for (const category of new Set([...purchases.keys(), ...refunds.keys()])) {
    const bought = purchases.get(category) ?? 0
    const refunded = refunds.get(category) ?? 0
    const applied = Math.min(bought, refunded)
    appliedRefundCents += applied
    if (refunded > bought) {
      unmatchedRefundCents += refunded - bought
      unmatchedCategories.push(category)
    }
    const net = bought - applied
    if (net > 0) {
      byCategory[category] = net
      totalCents += net
    }
  }
  return { totalCents, byCategory, appliedRefundCents, unmatchedRefundCents, unmatchedCategories }
}

// Records in the given month that still need the user to decide how they should be classified. Nothing is
// changed or hidden; every item here is already counted according to the safest default shown in its reason.
export function getClassificationFlags(classified, matchesMonth) {
  const inMonth = classified.filter(record => matchesMonth(record.date))
  const flags = []
  for (const record of inMonth) {
    for (const reason of record.flags) flags.push({ reason, transaction: record.transaction })
  }
  const { unmatchedCategories } = netSpending(getSpendingEntries(inMonth))
  for (const record of inMonth) {
    if (record.kind === 'refund' && unmatchedCategories.includes(record.category)) {
      flags.push({ reason: 'unmatched-refund', transaction: record.transaction })
    }
  }
  return flags.sort((a, b) =>
    String(a.transaction.date).localeCompare(String(b.transaction.date)) || (a.transaction.id ?? 0) - (b.transaction.id ?? 0))
}
