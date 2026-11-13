export const CONFIRMATION_CODE_LENGTH = 4

const CODE_SPACE = 10 ** CONFIRMATION_CODE_LENGTH

// Draws an unbiased four-digit code (0000-9999) from the browser's secure random source.
export function generateConfirmationCode(
  getRandomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)
) {
  if (typeof getRandomValues !== 'function') throw new Error('Secure random numbers are unavailable.')
  const limit = Math.floor(0x100000000 / CODE_SPACE) * CODE_SPACE
  const buffer = new Uint32Array(1)
  do {
    getRandomValues(buffer)
  } while (buffer[0] >= limit)
  return String(buffer[0] % CODE_SPACE).padStart(CONFIRMATION_CODE_LENGTH, '0')
}

// Every confirmation attempt gets a code different from the one before it.
export function nextConfirmationCode(previous = null, generate = generateConfirmationCode) {
  let code = generate()
  for (let attempt = 0; attempt < 10 && code === previous; attempt += 1) code = generate()
  if (!isValidCode(code) || code === previous) throw new Error('Could not create a new confirmation code.')
  return code
}

function isValidCode(code) {
  return typeof code === 'string' && new RegExp(`^\\d{${CONFIRMATION_CODE_LENGTH}}$`).test(code)
}

// The typed text must equal the displayed code exactly: no trimming, no partial matches.
export function isConfirmationMatch(typed, code) {
  return isValidCode(code) && typed === code
}

export function sanitizeCodeInput(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, CONFIRMATION_CODE_LENGTH)
}

// What each action tells the user. The lists match PROFILE_ACTION_KEYS in profileData.js.
export const DELETE_ACTIONS = {
  reset: {
    title: 'Reset App Data',
    removes: [
      'All transactions and transaction histories',
      'All bills and recurring income schedules',
      'All debts and debt payment history',
      'All budgets and budget spending data',
      'Your paycheck forecast (pay schedule)'
    ],
    keeps: [
      'Your accounts, with their names and types (balances are reset to $0)',
      'Categories and saved payees',
      'Preset and custom themes, appearance, and other settings'
    ],
    note: 'This cannot be undone.',
    finalSummary: 'This removes your transactions, bills, income schedules, debts, budgets, and paycheck forecast, and resets account balances to $0.',
    finalButton: 'Yes, Reset App Data',
    doneTitle: 'App Data Reset',
    doneMessage: 'Your transactions, bills, income schedules, debts, budgets, and paycheck forecast were removed. Your accounts, categories, payees, and themes were kept.'
  },
  delete: {
    title: 'Delete Profile',
    removes: [
      'All accounts and transactions',
      'All bills, income schedules, and debts',
      'All budgets, categories, and payees',
      'All custom themes and saved preferences'
    ],
    keeps: [
      'Your downloaded backup files'
    ],
    note: 'This deletes the local Money Honey profile and data on this device. It cannot be undone.',
    finalSummary: 'This permanently deletes all Money Honey data stored in this browser.',
    finalButton: 'Yes, Delete Profile',
    doneTitle: 'Profile Deleted',
    doneMessage: 'Your Money Honey profile and data were deleted from this device. Downloaded backup files were not affected.'
  }
}
