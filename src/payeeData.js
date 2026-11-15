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
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

export function savePayees(payees, storage = localStorage) {
  const names = payees.map(normalize)
  const previousCounts = new Map()
  for (const name of loadPayees(storage)) {
    const key = name.toLocaleLowerCase()
    previousCounts.set(key, (previousCounts.get(key) ?? 0) + 1)
  }
  const counts = new Map()
  for (const name of names) {
    if (!name) throw new Error('Enter a payee name.')
    const key = name.toLocaleLowerCase()
    const count = (counts.get(key) ?? 0) + 1
    if (count > 1 && count > (previousCounts.get(key) ?? 0)) throw new Error(`A payee named "${name}" already exists.`)
    counts.set(key, count)
  }
  names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  try {
    storage.setItem(PAYEE_STORAGE_KEY, JSON.stringify({ version: 1, payees: names }))
  } catch (error) {
    throw new Error('Could not save payees. Device storage may be full or unavailable. Your changes were not saved.', { cause: error })
  }
  return names
}
