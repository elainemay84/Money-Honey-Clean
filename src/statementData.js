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
  currentBalance: /^(?:current(?: outstanding| remaining)? balance|remaining(?: balance)?|outstanding(?: principal)? balance|new balance(?: total)?|principal balance)(?=\s|:|$)\s*:?\s*/i,
  interestRate: /^(?:(?:purchase )?apr|annual percentage rate|interest rate)(?:\s*\(apr\))?\s*:?\s*/i,
  minimumPayment: /^(?:total )?minimum payment(?: due)?\s*:?\s*/i,
  nextPaymentDue: /^(?:(?:next )?payment(?: due)? date|next payment due|next scheduled payment date|due date)\s*:?\s*/i,
  purchaseAmount: /^(?:original )?purchase amount\s*:?\s*/i,
  totalRepayment: /^(?:original )?(?:total repayment(?: amount)?|total financed(?: amount)?|total amount(?! due))\s*:?\s*/i,
  totalInterest: /^total interest\s*:?\s*/i,
  amountAlreadyPaid: /^(?:amount already paid|already paid|total paid|you(?:'|’)?ve paid|you have paid)\s*:?\s*/i,
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
  const match = /^(?:USD\s*)?\$?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)(?:\s*USD)?(?:\s+\([^()]*\))?$/.exec(value)
  if (!match) return null
  const number = Number(match[1].replaceAll(',', ''))
  return Number.isFinite(number) && number <= Number.MAX_SAFE_INTEGER / 100 ? String(number) : null
}

const MONEY = /\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?/g
const CAPTIONS = /(?:you(?:'|’)?ve paid|you have paid|amount (?:already )?paid|already paid|paid so far|total paid|remaining balance|balance remaining|current balance|remaining|total amount|total repayment|purchase amount|total interest)\b/gi
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

function captionKey(caption) {
  const text = caption.toLowerCase()
  if (/paid/.test(text)) return 'amountAlreadyPaid'
  if (/remaining|current balance/.test(text)) return 'currentBalance'
  if (/total (?:amount|repayment)/.test(text)) return 'totalRepayment'
  return text === 'purchase amount' ? 'purchaseAmount' : 'totalInterest'
}

// A caption row such as "You've paid  Remaining" followed by an amount row such as "$1,483.90  $296.74".
function pairColumns(header, amounts) {
  if (!header || /\$\s*\d/.test(header)) return []
  const captions = header.match(CAPTIONS) ?? []
  const values = amounts?.match(MONEY) ?? []
  const leftover = (amounts ?? '').replace(MONEY, ' ').trim()
  if (!captions.length || captions.length !== values.length || !/^[a-z'’]*$/i.test(leftover)) return []
  return captions.map((caption, index) => [captionKey(caption), values[index]])
}

// Returns a full date, or a yearless { month, day } that needs document context.
function parseDatePrefix(value) {
  const text = value.trim().replace(/(\d)(?:st|nd|rd|th)\b/i, '$1')
  const full = /^([a-z]+\.?\s+\d{1,2},?\s+\d{4})\b/i.exec(text)
  if (full) return parseDate(full[1].replace(/,?\s+(\d{4})$/, ', $1'))
  const partial = /^([a-z]+)\.?\s+(\d{1,2})\b(?!\s*[,/]?\s*\d)/i.exec(text)
  const month = partial ? MONTHS.findIndex(item => item === partial[1].toLowerCase() || item.slice(0, 3) === partial[1].toLowerCase()) : -1
  return month >= 0 ? { month: month + 1, day: Number(partial[2]) } : parseDate(text)
}

function isoDate(year, month, day) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return parseDate(value)
}

export function parseDebtStatement(lines) {
  const candidates = Object.fromEntries(STATEMENT_FIELDS.map(field => [field.key, new Set()]))
  const scheduledPayments = new Set()
  const yearlessDue = new Set()
  const purchaseDates = new Set()
  const headings = new Set()
  const isAmount = line => /^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(line ?? '')
  const add = (key, value) => {
    const parsed = parseValue(key, value)
    if (parsed !== null) candidates[key].add(parsed)
  }
  const addDue = value => {
    const date = value ? parseDatePrefix(value) : null
    if (typeof date === 'string') candidates.nextPaymentDue.add(date)
    else if (date) yearlessDue.add(`${date.month}-${date.day}`)
  }
  const textLines = lines.map(line => line.trim())
  for (let index = 0; index < textLines.length; index += 1) {
    const line = textLines[index]
    const installments = /^payments completed\s*:?\s*(\d+)\s*(?:of|\/)\s*(\d+)$/i.exec(line)
      ?? /^(?:progress\s*:?\s*)?(\d+)\s*(?:of|\/)\s*(\d+)\s+payments(?: completed)?$/i.exec(line)
      ?? (/\b(?:paid|remaining|payments?)\b/i.test(`${textLines[index - 1] ?? ''} ${line} ${textLines[index + 1] ?? ''}`)
        // OCR often reads a ring's "5 of 6" as "50f6".
        ? /^(\d{1,2})\s*[o0]f\s*(\d{1,2})(?![\d,.])/i.exec(line) : null)
    if (installments && Number(installments[1]) <= Number(installments[2])) {
      add('completedInstallments', installments[1])
      add('totalInstallments', installments[2])
    }
    const paymentLabel = /^next (?:scheduled )?payment(?: amount)?\s*:?\s*/i.exec(line)
    const upcoming = paymentLabel && /^(.+?)\s+on\s+(.+)$/i.exec(
      line.slice(paymentLabel[0].length).trim() || textLines[index + 1] || ''
    )
    if (upcoming) {
      add('nextPaymentAmount', upcoming[1])
      addDue(upcoming[2])
    }
    // App screenshots often show "$296.74 scheduled for Nov 16" without a payment label.
    const scheduled = /^(\$\s*[\d,]+(?:\.\d{1,2})?)\s+(?:is\s+)?(?:scheduled|due)\s+(?:for|on)\s+(.+)$/i.exec(line)
    if (scheduled) {
      const amount = parseValue('nextPaymentAmount', scheduled[1])
      if (amount !== null) scheduledPayments.add(amount)
      addDue(scheduled[2])
    }
    const purchased = /^purchase date\s*:?\s*(.*)$/i.exec(line)
    if (purchased) {
      const date = parseDatePrefix(purchased[1] || textLines[index + 1] || '')
      if (typeof date === 'string') purchaseDates.add(date)
    }
    // Large summary amounts are often displayed above a short caption such as "Remaining".
    const captioned = /^(?:remaining|remaining balance|balance remaining|current balance)$/i.test(line) && isAmount(textLines[index - 1])
    if (captioned) add('currentBalance', textLines[index - 1])
    // A caption already claimed by the amount above it is never paired again with the amount below.
    if (!captioned) for (const [key, value] of pairColumns(line, textLines[index + 1])) add(key, value)
    const embeddedApr = /\(\s*APR\s*:?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*\)?|\(\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*APR\s*\)/i.exec(line)
    if (embeddedApr) add('interestRate', `${embeddedApr[1] ?? embeddedApr[2]}%`)
    for (const [key, label] of Object.entries(labels)) {
      const match = label.exec(line)
      if (!match || (key === 'currentBalance' && captioned)) continue
      const value = line.slice(match[0].length).trim() || textLines[index + 1] || ''
      if (key === 'nextPaymentDue') addDue(value)
      else add(key, value)
    }
    const type = /^(Credit Card|Personal Loan|Auto Loan|Mortgage|Medical)(?: Account)? Statement$/i.exec(line)
    if (type) candidates.type.add(parseValue('type', type[1]))
    if (index < 3 && /^[a-z][a-z &'.-]+(?:bank|credit union|financial)$/i.test(line)) {
      candidates.name.add(line)
    }
    if (index < 4 && /^[a-z][a-z &'.-]+$/i.test(line)
      && !/\b(?:statement|purchase|payment|payments|balance|account|apr|plan|summary|activity|notice|details|due|overview|welcome|thank|your|remaining|paid|scheduled|total|interest|amount|back|close|done|cancel|menu|settings)\b/i.test(line)
      && parseValue('name', line) !== null) {
      headings.add(line)
    }
  }
  for (const amount of scheduledPayments) candidates.nextPaymentAmount.add(amount)
  // An installment app's scheduled payment is the required payment when no minimum is printed.
  if (!candidates.minimumPayment.size) {
    for (const amount of candidates.nextPaymentAmount) candidates.minimumPayment.add(amount)
  }
  // Resolve "Nov 16" only when the purchase date and plan length allow exactly one year.
  if (!candidates.nextPaymentDue.size && yearlessDue.size === 1 && purchaseDates.size === 1 && candidates.totalInstallments.size === 1) {
    const [month, day] = [...yearlessDue][0].split('-').map(Number)
    const purchase = [...purchaseDates][0]
    const [year, purchaseMonth, purchaseDay] = purchase.split('-').map(Number)
    const months = purchaseMonth - 1 + Number([...candidates.totalInstallments][0]) + 1
    const latest = isoDate(year + Math.floor(months / 12), (months % 12) + 1, Math.min(purchaseDay, 28))
    const options = [year, year + 1].map(item => isoDate(item, month, day))
      .filter(date => date && date > purchase && date <= latest)
    if (options.length === 1) candidates.nextPaymentDue.add(options[0])
  }
  // A heading is only a creditor name when the page also carries recognizable debt details.
  if (STATEMENT_FIELDS.some(({ key }) => key !== 'name' && key !== 'type' && candidates[key].size)) {
    for (const heading of headings) candidates.name.add(heading)
  }
  if (!candidates.type.size && (candidates.totalInstallments.size
    || (scheduledPayments.size && (candidates.purchaseAmount.size || candidates.totalRepayment.size)))) {
    candidates.type.add('Other')
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

function wordCenter(word) {
  return word?.bbox ? (word.bbox.x0 + word.bbox.x1) / 2 : null
}

// Uses OCR word positions to pair each caption with the amount directly below it.
function positionalPairs(header, amounts) {
  if (!header?.words?.length || !amounts?.words?.length) return []
  // Only a caption-only row over an amount-only row is a column layout; "Label $X" rows pair on their own line.
  if (/\$\s*\d/.test(header.text) || amounts.text.match(CAPTIONS)) return []
  const captions = []
  let text = ''
  const offsets = header.words.map(word => {
    const start = text.length
    text += `${word.text} `
    return [start, text.length - 1]
  })
  for (const match of text.matchAll(CAPTIONS)) {
    const words = header.words.filter((_, index) => offsets[index][0] < match.index + match[0].length && offsets[index][1] > match.index)
    const centers = words.map(wordCenter)
    if (!centers.length || centers.some(center => center == null)) return []
    captions.push({ key: captionKey(match[0]), x: centers.reduce((sum, value) => sum + value, 0) / centers.length })
  }
  const values = amounts.words.filter(word => /^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(word.text))
    .map(word => ({ text: word.text, x: wordCenter(word) }))
  if (!captions.length || !values.length || values.some(value => value.x == null)) return []
  const nearest = (item, list) => list.reduce((best, other) => Math.abs(other.x - item.x) < Math.abs(best.x - item.x) ? other : best)
  return captions.flatMap(caption => {
    const value = nearest(caption, values)
    return nearest(value, captions) === caption ? [`${caption.key === 'currentBalance' ? 'Remaining' : caption.key === 'amountAlreadyPaid' ? 'Already paid' : caption.key === 'totalRepayment' ? 'Total amount' : caption.key === 'purchaseAmount' ? 'Purchase amount' : 'Total interest'} ${value.text}`] : []
  })
}

// Logos, icons and buttons beside text are read as low-confidence noise; trim them instead of losing the line.
function withoutNoise(line) {
  const words = [...(line?.words ?? [])]
  const edgeNoise = word => word.confidence < 80 && (word.confidence < 40 || !/\d/.test(word.text))
  while (words.length && edgeNoise(words[0])) words.shift()
  while (words.length && edgeNoise(words.at(-1))) words.pop()
  const kept = words.filter(word => word.confidence >= 80 || /[\da-z]/i.test(word.text))
  if (!kept.length || kept.some(word => word.confidence < 80)) return null
  return { text: kept.map(word => word.text).join(' '), words: kept }
}

export function getReliableOcrLines(data) {
  const lines = (data.blocks ?? []).flatMap(block => block.paragraphs ?? [])
    .flatMap(paragraph => paragraph.lines ?? []).map(withoutNoise)
  return lines.flatMap((line, index) => {
    if (!line) return ['']
    const previous = lines[index - 1]
    return [line.text, ...(previous ? positionalPairs(previous, line) : [])]
  })
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
