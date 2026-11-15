export const STATEMENT_FIELDS = [
  { key: 'name', label: 'Creditor / Debt Name', type: 'text' },
  { key: 'type', label: 'Debt Type', type: 'select' },
  { key: 'accountLast4', label: 'Account Last 4 Digits', type: 'text' },
  { key: 'creditLimit', label: 'Credit Limit', type: 'number' },
  { key: 'currentBalance', label: 'Current Balance', type: 'number' },
  { key: 'interestRate', label: 'APR', type: 'number' },
  { key: 'minimumPayment', label: 'Minimum Payment', type: 'number' },
  { key: 'nextPaymentDue', label: 'Next Payment Due', type: 'date' },
  { key: 'purchaseAmount', label: 'Original Purchase Amount', type: 'number', plan: true },
  { key: 'totalRepayment', label: 'Original Total Repayment', type: 'number', plan: true },
  { key: 'totalInterest', label: 'Total Interest', type: 'number', plan: true },
  { key: 'amountAlreadyPaid', label: 'Amount Already Paid', type: 'number', plan: true },
  { key: 'totalInstallments', label: 'Total Installments', type: 'integer', plan: true },
  { key: 'completedInstallments', label: 'Completed Installments', type: 'integer', plan: true },
  { key: 'nextPaymentAmount', label: 'Next Payment Amount', type: 'number', plan: true }
]

export const DEBT_STATEMENT_FIELDS = STATEMENT_FIELDS.filter(field => !field.plan)

const labels = {
  name: /^(?:creditor(?: name)?|company(?: name)?|lender(?: name)?|issued by|debt name)(?=\s|:|$)\s*:?\s*/i,
  type: /^debt type\s*:?\s*/i,
  accountLast4: /^(?:account(?: number| no\.?| #| last (?:four|4)(?: digits)?)?|card(?: number)?)(?:\s+ending(?:\s+in)?)?\s*:?\s*/i,
  creditLimit: /^(?:total )?credit limit\s*:?\s*/i,
  currentBalance: /^(?:current(?: outstanding| remaining)? balance|remaining balance|outstanding(?: principal)? balance|new balance(?: total)?|principal balance)\s*:?\s*/i,
  interestRate: /^(?:(?:purchase )?apr|annual percentage rate|interest rate)(?:\s*\(apr\))?\s*:?\s*/i,
  minimumPayment: /^(?:total )?minimum payment(?: due)?\s*:?\s*/i,
  nextPaymentDue: /^(?:(?:next )?payment(?: due)? date|next payment due|next scheduled payment date|due date)\s*:?\s*/i,
  purchaseAmount: /^(?:original )?purchase amount\s*:?\s*/i,
  totalRepayment: /^(?:original )?(?:total repayment(?: amount)?|total financed(?: amount)?)\s*:?\s*/i,
  totalInterest: /^total interest\s*:?\s*/i,
  amountAlreadyPaid: /^(?:amount already paid|already paid|total paid)\s*:?\s*/i,
  totalInstallments: /^(?:total installments|number of installments)\s*:?\s*/i,
  completedInstallments: /^completed installments\s*:?\s*/i,
  nextPaymentAmount: /^next (?:scheduled )?payment(?: amount)?\s*:?\s*/i
}
const debtTypes = ['Credit Card', 'Personal Loan', 'Auto Loan', 'Mortgage', 'Medical', 'Other']

function parseDate(value) {
  let parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!parts) {
    const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
    if (numeric) {
      if (+numeric[1] <= 12 && +numeric[2] <= 12 && +numeric[1] !== +numeric[2]) return null
      parts = [value, numeric[3], numeric[1], numeric[2]]
    } else {
      const named = /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value)
      const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
      const month = named && months.findIndex(item =>
        item === named[1].toLowerCase() || item.slice(0, 3) === named[1].toLowerCase())
      if (!named || month < 0) return null
      parts = [value, named[3], String(month + 1), named[2]]
    }
  }
  const result = `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}`
  const date = new Date(`${result}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : null
}

function parseValue(key, value) {
  value = value.trim()
  if (key === 'name') {
    return value.length >= 2 && value.length <= 100 && value.replace(/\D/g, '').length < 5 && !/[*•●]{2}/.test(value)
      && !Object.values(labels).some(label => label.test(value)) ? value : null
  }
  if (key === 'type') return debtTypes.find(type => type.toLowerCase() === value.toLowerCase()) ?? null
  if (key === 'totalInstallments' || key === 'completedInstallments') {
    return /^\d{1,3}$/.test(value) && Number(value) <= 600 ? String(Number(value)) : null
  }
  if (key === 'nextPaymentDue') return parseDate(value)
  if (key === 'accountLast4') {
    const compact = value.replace(/[\s-]/g, '')
    return /^(?:[*xX•●#]*\d{4}|\d{8,19})$/.test(compact) ? compact.slice(-4) : null
  }
  if (key === 'interestRate') {
    const match = /^(\d{1,3}(?:\.\d{1,2})?)\s*%$/.exec(value)
    return match ? String(Number(match[1])) : null
  }
  const match = /^(?:USD\s*)?\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*USD)?$/.exec(value)
  if (!match) return null
  const number = Number(match[1].replaceAll(',', ''))
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER / 100 ? String(number) : null
}

export function parseDebtStatement(lines) {
  const candidates = Object.fromEntries(STATEMENT_FIELDS.map(field => [field.key, new Set()]))
  const textLines = lines.map(line => line.trim())
  for (let index = 0; index < textLines.length; index += 1) {
    const line = textLines[index]
    const installments = /^payments completed\s*:?\s*(\d+)\s*(?:of|\/)\s*(\d+)$/i.exec(line)
      ?? /^(?:progress\s*:?\s*)?(\d+)\s*(?:of|\/)\s*(\d+)\s+payments(?: completed)?$/i.exec(line)
    if (installments && Number(installments[1]) <= Number(installments[2])) {
      for (const [key, value] of [['completedInstallments', installments[1]], ['totalInstallments', installments[2]]]) {
        const parsed = parseValue(key, value)
        if (parsed !== null) candidates[key].add(parsed)
      }
    }
    const paymentLabel = /^next (?:scheduled )?payment(?: amount)?\s*:?\s*/i.exec(line)
    const upcoming = paymentLabel && /^(.+?)\s+on\s+(.+)$/i.exec(
      line.slice(paymentLabel[0].length).trim() || textLines[index + 1] || ''
    )
    if (upcoming) {
      const amount = parseValue('nextPaymentAmount', upcoming[1])
      const date = parseDate(upcoming[2])
      if (amount !== null) candidates.nextPaymentAmount.add(amount)
      if (date !== null) candidates.nextPaymentDue.add(date)
    }
    for (const [key, label] of Object.entries(labels)) {
      const match = label.exec(line)
      if (!match) continue
      const value = line.slice(match[0].length).trim() || textLines[index + 1] || ''
      const parsed = parseValue(key, value)
      if (parsed !== null) candidates[key].add(parsed)
    }
    const type = /^(Credit Card|Personal Loan|Auto Loan|Mortgage|Medical)(?: Account)? Statement$/i.exec(line)
    if (type) candidates.type.add(parseValue('type', type[1]))
    if (index < 3 && /^[a-z][a-z &'.-]+(?:bank|credit union|financial)$/i.test(line)) {
      candidates.name.add(line)
    }
    if (index < 3 && /^[a-z][a-z &'.-]+$/i.test(line)
      && !/\b(?:statement|purchase|payment|balance|account|apr|plan|summary|activity|notice|details|due|overview|welcome|thank|your)\b/i.test(line)
      && /^(?:purchase (?:date|amount)|current(?: remaining| outstanding)? balance)\b/i.test(textLines[index + 1] ?? '')
      && parseValue('name', line) !== null) {
      candidates.name.add(line)
    }
  }
  const values = {}
  const missing = []
  const conflicts = []
  const plan = STATEMENT_FIELDS.some(field => field.plan && candidates[field.key].size)
  for (const { key } of STATEMENT_FIELDS.filter(field => !field.plan || plan)) {
    if (candidates[key].size === 1) values[key] = [...candidates[key]][0]
    else {
      missing.push(key)
      if (candidates[key].size > 1) conflicts.push(key)
    }
  }
  const warnings = []
  if (values.totalRepayment != null && values.purchaseAmount != null && values.totalInterest != null
    && Math.abs(Number(values.purchaseAmount) + Number(values.totalInterest) - Number(values.totalRepayment)) > 0.011) {
    warnings.push('Purchase amount plus stated interest does not match the total repayment. Review the provider totals; no amounts were recalculated.')
  }
  if (values.totalRepayment != null && values.amountAlreadyPaid != null && values.currentBalance != null
    && Math.abs(Number(values.amountAlreadyPaid) + Number(values.currentBalance) - Number(values.totalRepayment)) > 0.011) {
    warnings.push('Already paid plus remaining balance does not match the total repayment. Review these amounts before saving.')
  }
  return { values, missing, conflicts, ...(warnings.length ? { warnings } : {}) }
}

export function getReliableOcrLines(data) {
  return (data.blocks ?? []).flatMap(block => block.paragraphs ?? [])
    .flatMap(paragraph => paragraph.lines ?? [])
    .map(line => line.words?.length && line.words.every(word => word.confidence >= 80) ? line.text : '')
}

export function validateStatementSuggestions(values) {
  const result = {}
  for (const { key, label, type } of STATEMENT_FIELDS) {
    if (!Object.hasOwn(values, key)) continue
    const value = String(values[key]).trim()
    const parsed = key === 'accountLast4' && !/^\d{4}$/.test(value) ? null
      : key === 'interestRate' ? parseValue(key, `${value}%`) : parseValue(key, value)
    if (parsed === null || (type === 'number' && Number(parsed) < 0)) {
      throw new Error(`Enter a valid ${label.toLowerCase()} or uncheck it.`)
    }
    result[key] = parsed
  }
  if (!Object.keys(result).length) throw new Error('Select at least one suggestion to apply.')
  return result
}
