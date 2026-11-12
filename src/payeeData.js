export const PAYEE_STORAGE_KEY = 'money-honey-payees'

function normalize(name) {
  return String(name ?? '').trim()
}

export function loadPayees(storage = localStorage) {
  const saved = storage.getItem(PAYEE_STORAGE_KEY)
  if (saved === null) return []
  let data
  try {
    data = JSON.parse(saved)
  } catch (error) {
    throw new Error('Saved Money Honey payees could not be read.', { cause: error })
  }
  if (!data || !Array.isArray(data.payees)) {
    throw new Error('Saved Money Honey payees are invalid.')
  }
  return [...new Set(data.payees.map(normalize).filter(Boolean))]
}

export function savePayees(payees, storage = localStorage) {
  const unique = [...new Set(payees.map(normalize).filter(Boolean))]
  storage.setItem(PAYEE_STORAGE_KEY, JSON.stringify({ version: 1, payees: unique }))
  return unique
}
