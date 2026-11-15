export function parseFinancialAmount(value, label = 'Amount', { signed = false, optional = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text && optional) return null
  const sign = signed ? '-?' : ''
  const number = '(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:[.][0-9]{0,2})?|[.][0-9]{1,2}'
  if (!new RegExp(`^${sign}(?:${number})$`).test(text)) throw new Error(`${label}: enter a valid amount with at most two decimal places.`)
  const amount = Number(text.replaceAll(',', ''))
  if (!Number.isFinite(amount) || Math.abs(amount) > Number.MAX_SAFE_INTEGER / 100) throw new Error(`${label} is too large.`)
  return amount
}

export function parseInstallmentCount(value, label) {
  if (!/^[0-9]+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${label} must be a whole number.`)
  }
  return Number(value)
}
