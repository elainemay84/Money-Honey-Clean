import { inferPaymentFrequency } from './debtSchedule.js'

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
  { key: 'nextPaymentAmount', label: 'Next Payment Amount', type: 'number', plan: true },
  { key: 'provider', label: 'Provider', type: 'text', plan: true },
  { key: 'merchant', label: 'Merchant', type: 'text', plan: true },
  { key: 'purchaseCategory', label: 'Purchase Category', type: 'text', plan: true }
]

export const DEBT_STATEMENT_FIELDS = STATEMENT_FIELDS.filter(field => !field.plan)

const labels = {
  name: /^(?:creditor(?: name)?|company(?: name)?|lender(?: name)?|issued by|debt name)(?=\s|:|$)\s*:?\s*/i,
  type: /^debt type\s*:?\s*/i,
  accountLast4: /^(?:account(?: number| no\.?| #| last (?:four|4)(?: digits)?)?|card(?: number)?)(?:\s+ending(?:\s+in)?)?\s*:?\s*/i,
  creditLimit: /^(?:total )?credit limit\s*:?\s*/i,
  currentBalance: /^(?:current(?: outstanding| remaining)? balance|remaining to pay|left to pay|balance remaining|remaining(?: balance)?|outstanding(?: principal)? balance|new balance(?: total)?|principal balance)(?=\s|:|$)\s*:?\s*/i,
  interestRate: /^(?:(?:purchase )?apr|annual percentage rate|interest rate)(?:\s*\(apr\))?\s*:?\s*/i,
  minimumPayment: /^(?:total )?minimum payment(?: due)?\s*:?\s*/i,
  nextPaymentDue: /^(?:(?:next )?payment(?: due)? date|next payment due|next scheduled payment date|(?:next )?due date)\s*:?\s*/i,
  purchaseAmount: /^(?:(?:original )?purchase (?:amount|total|price)|order total|order amount)(?=\s|:|$)\s*:?\s*/i,
  totalRepayment: /^(?:original )?(?:total repayment(?: amount)?|total financed(?: amount)?|total with interest|total amount(?! due))\s*:?\s*/i,
  totalInterest: /^(?:total )?interest\s*:?\s*/i,
  amountAlreadyPaid: /^(?:amount already paid|already paid|total paid|you(?:'|’)?ve paid|you have paid)\s*:?\s*/i,
  totalInstallments: /^(?:total installments|number of (?:installments|payments))\s*:?\s*/i,
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
      const dayFirst = /^(\d{1,2})\s+([a-z]+)\.?,?\s+(\d{4})$/i.exec(value)
      const named = dayFirst ? [value, dayFirst[2], dayFirst[1], dayFirst[3]]
        : /^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(value)
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
  if (['provider', 'merchant', 'purchaseCategory'].includes(key)) {
    return value.length > 0 && value.length <= 100 && !value.includes(UNREADABLE) ? value : null
  }
  if (key === 'name') {
    return value.length >= 2 && value.length <= 100 && value.replace(/\D/g, '').length < 5 && !/[*•●]{2}/.test(value)
      && !/^(?:checkout|in progress|activity|payment activity|payment schedule|overview|summary)$/i.test(value)
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
  if (!header || /\$\s*\d/.test(header) || header.includes(UNREADABLE)) return []
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

export function resolveScannedMonthlyDates(rows, firstDate) {
  if (!parseDate(firstDate) || rows.length < 2 || rows.some(row => row.dueDate || !row.scannedDate)) return null
  const partials = rows.map(row => parseDatePrefix(row.scannedDate))
  if (partials.some(date => !date || typeof date === 'string')) return null
  const [year, month, day] = firstDate.split('-').map(Number)
  if (partials[0].month !== month || partials[0].day !== day
    || partials.some((date, index) => date.day !== day || date.month !== (month - 1 + index) % 12 + 1)) return null
  const dates = partials.map((date, index) => isoDate(year + Math.floor((month - 1 + index) / 12), date.month, date.day))
  if (dates.some(date => !date)) return null
  return rows.map((row, index) => ({ ...row, dueDate: dates[index] }))
}

export function parseDebtStatement(lines, { paymentPlan = false } = {}) {
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
  const textLines = lines.map(line => paymentPlan
    ? line.trim().replace(/^remaining scheduled balance\b/i, 'Remaining balance')
    : line.trim())
  for (let index = 0; index < textLines.length; index += 1) {
    const line = textLines[index]
    if (paymentPlan) {
      const count = /^(\d{1,3})\s+(?:monthly\s+)?payments$/i.exec(line)
      if (count) add('totalInstallments', count[1])
    }
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
      ?? (paymentPlan ? /^autopay(?: amount| payment)?\s*:?\s*/i.exec(line) : null)
    const upcoming = paymentLabel && /^(.+?)\s+on\s+(.+)$/i.exec(
      line.slice(paymentLabel[0].length).trim() || textLines[index + 1] || ''
    )
    if (upcoming) {
      add('nextPaymentAmount', upcoming[1])
      addDue(upcoming[2])
    } else if (paymentLabel && /^autopay/i.test(line)) {
      add('nextPaymentAmount', line.slice(paymentLabel[0].length).trim() || textLines[index + 1] || '')
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
    const embeddedApr = /[({]\s*APR\s*:?\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*\)?|[({]\s*(\d{1,3}(?:\.\d{1,2})?)\s*%\s*APR\s*\)/i.exec(line)
    if (embeddedApr) add('interestRate', `${embeddedApr[1] ?? embeddedApr[2]}%`)
    if (paymentPlan && embeddedApr && /^(?:total )?interest\b/i.test(line)) {
      const amounts = line.match(MONEY) ?? []
      if (amounts.length === 1) add('totalInterest', amounts[0])
    }
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
      && !/\b(?:statement|purchase|payment|payments|balance|account|apr|plan|summary|activity|notice|details|due|overview|welcome|thank|your|remaining|paid|scheduled|total|interest|amount|back|close|done|cancel|menu|settings|progress|autopay)\b/i.test(line)
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
  if (textLines.includes('[OCR recheck failed]')) {
    warnings.push('Some unclear values could not be rechecked. Review and complete the form manually.')
  }
  const scheduleWarnings = []
  const planDetails = parsePaymentPlanStatement(textLines, { paymentPlan })
  Object.assign(values, planDetails.values)
  if (paymentPlan) {
    const names = new Set(textLines.flatMap(line => {
      const named = /^(?:plan name|item|purchase name)\s*:\s*(.+)$/i.exec(line)
        ?? /^(.+?)\s+on\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i.exec(line)
      const name = named?.[1]?.trim()
      return name && parseValue('name', name) && !/\b(?:payment|autopay|due|scheduled)\b/i.test(name) ? [name] : []
    }))
    if (names.size === 1) values.name = [...names][0]
    else if (values.merchant) values.name = values.merchant
    else if (!values.name && values.provider) values.name = values.provider
    const next = planDetails.installments.filter(row => row.dueDate && !row.paid)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
    if (next) {
      values.nextPaymentDue = next.dueDate
      if (next.amount) values.nextPaymentAmount = next.amount
    }
    if (values.nextPaymentAmount) values.minimumPayment = values.nextPaymentAmount
    if (!values.totalInstallments && planDetails.installments.length) values.totalInstallments = String(planDetails.installments.length)
  }
  if (planDetails.installments.length) {
    if (!values.type) values.type = 'Other'
    if ((!values.name || values.name.toLowerCase() === values.provider?.toLowerCase()) && (values.provider || values.merchant)) {
      values.name = [values.provider, values.merchant].filter(Boolean).join(' - ')
    }
    if (paymentPlan && planDetails.unresolvedDates.length) {
      warnings.push('Some scanned dates have no year. Confirm each scanned month and day and enter its full date.')
    }
    scheduleWarnings.push('Schedule found from statement. Review before saving.')
    if (values.totalInstallments && Number(values.totalInstallments) !== planDetails.installments.length) {
      scheduleWarnings.push('The visible rows do not match the stated installment count. Add the missing installments before saving.')
    }
  }
  if (values.totalRepayment != null && values.purchaseAmount != null && values.totalInterest != null
    && Math.abs(Number(values.purchaseAmount) + Number(values.totalInterest) - Number(values.totalRepayment)) > 0.011) {
    warnings.push('Purchase amount plus stated interest does not match the total repayment. Review the provider totals; no amounts were recalculated.')
  }
  if (values.totalRepayment != null && values.amountAlreadyPaid != null && values.currentBalance != null
    && Math.abs(Number(values.amountAlreadyPaid) + Number(values.currentBalance) - Number(values.totalRepayment)) > 0.011) {
    warnings.push('Already paid plus remaining balance does not match the total repayment. Review these amounts before saving.')
  }
  warnings.push(...scheduleWarnings)
  const rows = planDetails.installments
  if (paymentPlan && planDetails.partialFrequency === 'monthly' && Number(values.totalInstallments) === rows.length
    && rows.length >= 4 && rows.every(row => row.amount !== '') && values.totalRepayment != null) {
    const monthlyAmounts = new Set(textLines.flatMap(line => {
      const match = /^\s*(\$\s*[\d,]+\.\d{2})\s+per month\s*$/i.exec(line)
      const amount = match && parseValue('nextPaymentAmount', match[1])
      return amount == null ? [] : [Math.round(Number(amount) * 100)]
    }))
    const [regular] = monthlyAmounts
    const cents = rows.map(row => Math.round(Number(row.amount) * 100))
    const outliers = cents.slice(0, -1).flatMap((amount, index) => amount !== regular ? [index] : [])
    if (monthlyAmounts.size === 1 && outliers.length === 1
      && Math.abs(cents.at(-1) - regular) <= 1
      && cents.reduce((sum, amount) => sum + amount, 0) - cents[outliers[0]] + regular === Math.round(Number(values.totalRepayment) * 100)) {
      const original = cents[outliers[0]].toString()
      const corrected = regular.toString()
      if (original.length === corrected.length && [...original].filter((digit, index) => digit !== corrected[index]).length === 1) {
        rows[outliers[0]].amount = (regular / 100).toFixed(2)
        warnings.push(`Installment ${outliers[0] + 1} was corrected to match the printed monthly payment and total. Review it before saving.`)
      }
    }
  }
  if (paymentPlan && values.totalRepayment != null && rows.length
    && rows.every(row => row.amount !== '')
    && Number(values.totalInstallments) === rows.length
    && rows.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0) !== Math.round(Number(values.totalRepayment) * 100)) {
    warnings.push('The scanned installment amounts do not match the stated total repayment. Review both before saving.')
  }
  const planTerms = rows.length ? {
    count: String(rows.length),
    firstDate: rows.map(row => row.dueDate).filter(Boolean).sort()[0] ?? '',
    frequency: inferPaymentFrequency(rows) || planDetails.partialFrequency
  } : null
  return {
    values, missing: missing.filter(key => !Object.hasOwn(values, key)),
    conflicts: conflicts.filter(key => !Object.hasOwn(values, key)),
    ...(rows.length ? { installments: rows, planTerms } : {}),
    ...(paymentPlan && planDetails.unresolvedDates.length ? { dateHints: planDetails.dateHints } : {}),
    ...(warnings.length ? { warnings } : {})
  }
}

export function parsePaymentPlanScan(lines) {
  return parseDebtStatement(pairHorizontalTimeline(lines), { paymentPlan: true })
}

const ROW_DATE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*|\s+)\d{4}|\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?,?\s+\d{4})\b/i
const PARTIAL_ROW_DATE = /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}\b/i
const INSTALLMENT_LABEL = /^(?:installment|payment)\s*#?\s*\d+\b(?:\s*(?:of|\/)\s*\d+)?\s*[:.)-]?\s*/i
const INSTALLMENT_STATUS = /^(?:paid|completed|unpaid|not paid|not completed|upcoming|scheduled|due|pending|overdue|autopay)$/i
const INSTALLMENT_AMOUNT_CELL = /^(?:(?:paid|completed|due|upcoming|scheduled|unpaid|pending|overdue)\s+)?(?:\$\s*[\d,.]+|(?:USD\s*)?\d[\d,]*\.\d{2}(?:\s*USD)?)(?:\s+(?:paid|completed|due|upcoming|scheduled|unpaid|pending|overdue))?$/i

function pairHorizontalTimeline(lines) {
  const result = []
  const datePattern = `${ROW_DATE.source}|${PARTIAL_ROW_DATE.source}`
  const datesIn = line => [...line.matchAll(new RegExp(datePattern, 'gi'))]
  const amountsIn = line => [...line.matchAll(MONEY)]
  const empty = text => !text.replace(/[\s|·•-]/g, '')
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const next = lines[index + 1] ?? ''
    const pairs = [...line.matchAll(new RegExp(`(${datePattern})\\s+(\\$\\s*[\\d,]+(?:\\.\\d{1,2})?)`, 'gi'))]
    if (pairs.length > 1 && empty(line.replace(new RegExp(`(${datePattern})\\s+(\\$\\s*[\\d,]+(?:\\.\\d{1,2})?)`, 'gi'), ''))) {
      result.push(...pairs.map(pair => `${pair[1]} ${pair[2]}`))
      continue
    }
    const datesFirst = datesIn(line).length > 1
    const dateLine = datesFirst ? line : next
    const amountLine = datesFirst ? next : line
    const dates = datesIn(dateLine)
    const amounts = amountsIn(amountLine)
    if (dates.length > 1 && dates.length === amounts.length
      && empty(dateLine.replace(new RegExp(datePattern, 'gi'), '')) && empty(amountLine.replace(MONEY, ''))) {
      result.push(...dates.map((date, i) => `${date[0]} ${amounts[i][0]}`))
      index += 1
    } else result.push(line)
  }
  return result
}

function installmentAmount(text) {
  if (/\bCR\b/i.test(text)) return ''
  const amounts = text.match(/(?:[-(]\s*)?\$\s*[^\s|;]+/g) ?? []
  if (amounts.length) return amounts.length === 1 ? parseValue('nextPaymentAmount', amounts[0]) ?? '' : ''
  // Currency-free table cells are accepted only as a complete amount with explicit cents.
  const cell = text.replace(ROW_DATE, '').replace(PARTIAL_ROW_DATE, '').replace(INSTALLMENT_LABEL, '')
    .replace(/\b(?:paid|completed|unpaid|not|upcoming|scheduled|due|pending|overdue|autopay|on)\b/gi, '').trim()
  return /^(?:USD\s*)?\d[\d,]*\.\d{2}(?:\s*USD)?$/.test(cell) ? parseValue('nextPaymentAmount', cell) ?? '' : ''
}

// Timeline circles and connectors beside each row are read as "O", "0", "©", "|" or an unreadable "[?]" word.
// Only tokens before "$" or a month are stripped, so a minus sign or a split amount digit is never discarded.
const TIMELINE_MARKER = new RegExp(`^(?:(?:\\[\\?\\]|[✓✔√vVoO0Q@©®•●○◯◦|│¦!lI1()\\[\\]—~=*]{1,3})\\s+)+(?=\\$|${PARTIAL_ROW_DATE.source.slice(2)})`, 'i')

function cleanRowLine(text, timeline) {
  const line = (text ?? '').replace(/\s*\|\s*/g, ' ').trim()
  return timeline ? line.replace(TIMELINE_MARKER, '') : line
}

// "Dec 15" in a chronological timeline takes its year from the nearest explicitly dated rows.
function resolveYearlessRows(rows) {
  const dated = rows.filter(row => row.dueDate)
  if (dated.length < 2 || dated.some((row, index) => index && row.dueDate <= dated[index - 1].dueDate)) return
  rows.forEach((row, index) => {
    if (row.dueDate || !row.partial) return
    const previous = rows.slice(0, index).findLast(item => item.dueDate)?.dueDate
    const next = rows.slice(index + 1).find(item => item.dueDate)?.dueDate
    const { month, day } = row.partial
    const before = next && [0, 1].map(back => isoDate(Number(next.slice(0, 4)) - back, month, day)).find(date => date && date < next)
    const after = previous && [0, 1].map(ahead => isoDate(Number(previous.slice(0, 4)) + ahead, month, day)).find(date => date && date > previous)
    const date = next && previous ? (before === after ? before : null) : before || after
    if (date) row.dueDate = date
  })
}

export function parsePaymentPlanStatement(lines, { paymentPlan = false } = {}) {
  const values = {}
  const provider = new Set()
  const merchants = new Set()
  const categories = new Set()
  const installments = []
  const timelineStart = paymentPlan
    ? lines.findIndex(line => /^(?:(?:payment|recent) )?(?:activity|schedule|installments)\s*:?\s*$/i.test(line))
    : -1
  for (let index = 0; index < lines.length; index += 1) {
    const timeline = paymentPlan && index > timelineStart
    const line = cleanRowLine(lines[index], timeline)
    const brand = /^(?:provider\s*:\s*)?(OnePay Later(?:,?\s+powered by Klarna)?|Afterpay|Klarna|Affirm|PayPal(?: Pay Later| Pay in (?:3|4))?)(?:\s*[-:]\s*.*|\s+(?:payment plan|payment schedule|pay in (?:3|4))|\s+\[\?\])?$/i.exec(line)
    if (brand) provider.add(brand[1])
    const namedProvider = paymentPlan && /^provider\s*:\s*(.+)$/i.exec(line)
    if (namedProvider && parseValue('provider', namedProvider[1])) provider.add(namedProvider[1])
    const merchant = /^(?:merchant|purchased? (?:at|from)|store)\s*:\s*(.+)$/i.exec(line)
    if (merchant && parseValue('merchant', merchant[1])) merchants.add(merchant[1])
    const category = /^(?:purchase )?category\s*:\s*(.+)$/i.exec(line)
    if (category && parseValue('purchaseCategory', category[1])) categories.add(category[1])
    if (index < timelineStart) continue
    const rowLabel = INSTALLMENT_LABEL.test(line)
    const initialDate = ROW_DATE.exec(line) ?? PARTIAL_ROW_DATE.exec(line)
    const datePrefix = initialDate ? line.slice(0, initialDate.index) : ''
    const dateRow = initialDate && (/^(?:(?:due|upcoming|scheduled|unpaid|paid|completed|pending|overdue)\s*:?\s*)?(?:(?:\$\s*[\d,.]+|\d[\d,]*\.\d{2})\s+)?$/i.test(datePrefix)
      || (paymentPlan && /^(?:(?:payment\s+)?(?:due|upcoming|scheduled|unpaid|paid|completed|pending|overdue)\s*:?\s*(?:on\s*)?)?$/i.test(
        datePrefix.replace(/(?:\$\s*[\d,.]+|\d[\d,]*\.\d{2})\s*/, '').trim()
      )))
    const summaryDate = /^(?:(?:purchase|order|statement) date|next (?:scheduled )?payment(?: due)?(?: date)?|payment (?:due )?date|(?:next )?due date)\s*:?\s*$/i.test(lines[index - 1]?.trim() ?? '')
      // The autopay summary repeats the next installment; it is never a timeline row of its own.
      || /^autopay\b[^$\d]*$/i.test(lines[index - 1]?.trim() ?? '')
    if (!rowLabel && (!dateRow || summaryDate)) continue
    // Read a bounded vertical card (label, date, amount, status), stopping at the next installment.
    let consumed = 0
    let rowText = line
    while (consumed < 3) {
      const next = cleanRowLine(lines[index + consumed + 1], timeline)
      if (!next || INSTALLMENT_LABEL.test(next)) break
      const nextDate = ROW_DATE.exec(next) ?? PARTIAL_ROW_DATE.exec(next)
      const hasDate = ROW_DATE.test(rowText) || PARTIAL_ROW_DATE.test(rowText)
      const amountCell = INSTALLMENT_AMOUNT_CELL.test(next)
      if (nextDate && !hasDate && rowLabel && !rowText.includes('$') && !installmentAmount(rowText) && nextDate.index === 0) rowText += ` ${next}`
      else if (!nextDate && amountCell && !rowText.includes('$') && !installmentAmount(rowText)) {
        // A date column followed by an amount column has no reliable sequential pairing.
        if (paymentPlan && initialDate && installments.at(-1)?.amount === ''
          && INSTALLMENT_AMOUNT_CELL.test(cleanRowLine(lines[index + consumed + 2], timeline))) break
        rowText += ` ${next}`
      }
      else if (INSTALLMENT_STATUS.test(next) && !/\b(?:paid|completed|unpaid|pending|overdue)\b/i.test(rowText)) rowText += ` ${next}`
      else break
      consumed += 1
    }
    const dateMatch = ROW_DATE.exec(rowText)
    const amount = installmentAmount(rowText)
    if (rowLabel || initialDate) {
      const partial = !dateMatch && PARTIAL_ROW_DATE.exec(rowText)
      const yearless = partial && parseDatePrefix(partial[0])
      installments.push({
        dueDate: dateMatch ? parseDate(dateMatch[0]) ?? '' : '',
        amount,
        paid: /\b(?:paid|completed)\b/i.test(rowText) && !/\b(?:unpaid|not(?: yet)? (?:paid|completed)|partially paid|pending|failed|due|upcoming|scheduled)\b/i.test(rowText),
        ...(paymentPlan && /\bpending\b/i.test(rowText) ? { status: 'pending' } : {}),
        ...(yearless?.month ? { partial: yearless } : {}),
        ...(rowLabel ? { labeled: true } : {})
      })
      index += consumed
    }
  }
  resolveYearlessRows(installments)
  const relevantRows = installments.filter(row => row.labeled || row.dueDate || row.amount)
  const dateHints = relevantRows.map(row => !row.dueDate && row.partial
    ? `${MONTHS[row.partial.month - 1].slice(0, 3)} ${row.partial.day}` : '')
  const unresolvedDates = dateHints.filter(Boolean)
  const partialRows = installments.map(row => row.partial)
  const partialFrequency = partialRows.length > 1 && partialRows.every(Boolean)
    && partialRows.every((date, index) => !index || (date.month === partialRows[index - 1].month % 12 + 1 && date.day === partialRows[0].day))
    ? 'monthly' : ''
  // An unlabeled match with neither a usable date nor an amount is OCR noise, not an installment.
  const rows = relevantRows
    .map(({ dueDate, amount, paid, status }) => ({ dueDate, amount, paid, ...(status ? { status } : {}) }))
  if (provider.size === 1) values.provider = [...provider][0]
  if (merchants.size === 1) values.merchant = [...merchants][0]
  if (categories.size === 1) values.purchaseCategory = [...categories][0]
  const planContext = paymentPlan || provider.size > 0 || lines.some(line => /\b(?:installments?|payments completed|payment plan|pay in \d+|\d+ (?:monthly |biweekly )?payments)\b/i.test(line))
  return { values, installments: planContext ? rows : [], unresolvedDates, dateHints, partialFrequency }
}

export const BILL_STATEMENT_FIELDS = [
  { key: 'name', label: 'Bill Name', type: 'text' },
  { key: 'amount', label: 'Bill Amount', type: 'number' },
  { key: 'dueDate', label: 'Bill Due Date', type: 'date' },
  { key: 'category', label: 'Bill Category', type: 'text' }
]

export function parseBillStatement(lines) {
  const candidates = Object.fromEntries(BILL_STATEMENT_FIELDS.map(({ key }) => [key, new Set()]))
  const patterns = {
    name: /^(?:bill name|biller|company|provider|payee)(?=\s|:|$)\s*:?\s*(.*)$/i,
    amount: /^(?:(?:total )?amount due|total due|bill amount|balance due)(?=\s|:|$)\s*:?\s*(.*)$/i,
    dueDate: /^(?:due date|payment due(?: date)?)(?=\s|:|$)\s*:?\s*(.*)$/i,
    category: /^category(?=\s|:|$)\s*:?\s*(.*)$/i
  }
  for (let index = 0; index < lines.length; index += 1) {
    for (const [key, pattern] of Object.entries(patterns)) {
      const line = lines[index].trim()
      const match = pattern.exec(line)
      if (!match) continue
      const raw = match?.[1]?.trim() || lines[index + 1]?.trim() || ''
      const value = key === 'amount' ? parseValue('minimumPayment', raw)
        : key === 'dueDate' ? parseDate(raw) : key === 'name' ? parseValue('name', raw)
          : parseValue('purchaseCategory', raw)
      if (value != null) candidates[key].add(value)
    }
    if (!candidates.name.size && (candidates.amount.size || candidates.dueDate.size)) {
      const headings = lines.slice(0, 3).map(line => line.trim()).filter(line =>
        /^[a-z][a-z &'.-]+$/i.test(line) && parseValue('name', line)
        && !/\b(?:bill|statement|invoice|account|payment|summary|amount|due|date|total|balance|page)\b/i.test(line))
      if (new Set(headings).size === 1) candidates.name.add(headings[0])
    }
  }
  return {
    values: Object.fromEntries(Object.entries(candidates).filter(([, values]) => values.size === 1).map(([key, values]) => [key, [...values][0]])),
    missing: Object.keys(candidates).filter(key => candidates[key].size !== 1),
    conflicts: Object.keys(candidates).filter(key => candidates[key].size > 1)
  }
}

export function validateBillStatementSuggestions(values) {
  const result = {}
  for (const { key, label } of BILL_STATEMENT_FIELDS) {
    if (!Object.hasOwn(values, key)) continue
    const value = String(values[key]).trim()
    const parsed = key === 'amount' ? parseValue('minimumPayment', value)
      : key === 'dueDate' ? parseDate(value) : parseValue('merchant', value)
    if (parsed == null) throw new Error(`Enter a valid ${label.toLowerCase()} or uncheck it.`)
    result[key] = parsed
  }
  if (!Object.keys(result).length) throw new Error('Select at least one suggestion to apply.')
  return result
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
    if (!words.length || words.some(word => !word.bbox)) return []
    const x0 = Math.min(...words.map(word => word.bbox.x0))
    const x1 = Math.max(...words.map(word => word.bbox.x1))
    captions.push({ key: captionKey(match[0]), x: (x0 + x1) / 2, x0, x1 })
  }
  const values = amounts.words.filter(word => /^\$\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(word.text))
    .map(word => ({ text: word.text, x: wordCenter(word), x0: word.bbox?.x0, x1: word.bbox?.x1 }))
  if (!captions.length || !values.length || values.some(value => value.x == null)) return []
  const nearest = (item, list) => list.reduce((best, other) => Math.abs(other.x - item.x) < Math.abs(best.x - item.x) ? other : best)
  // A caption only describes an amount that sits horizontally beneath it.
  const overlaps = (caption, value) => value.x0 < caption.x1 && value.x1 > caption.x0
  return captions.flatMap(caption => {
    const value = nearest(caption, values)
    return nearest(value, captions) === caption && overlaps(caption, value) ? [`${caption.key === 'currentBalance' ? 'Remaining' : caption.key === 'amountAlreadyPaid' ? 'Already paid' : caption.key === 'totalRepayment' ? 'Total amount' : caption.key === 'purchaseAmount' ? 'Purchase amount' : 'Total interest'} ${value.text}`] : []
  })
}

const UNREADABLE = '[?]'
const trusted = word => word.confidence >= 80
  // Progress rings such as "5 of 6" (often read as "50f6") only bound the due-date year, never an amount.
  || (word.confidence >= 60 && /^\d{1,2}[o0]f\d{1,2}$/i.test(word.text))

// Logos, icons and buttons beside text are read as low-confidence noise; trim them instead of losing the line.
// Smaller images (for example iPhone photo-picker copies) lower confidence word by word, so an uncertain word
// becomes a placeholder that no label or amount accepts instead of discarding confident words on the same line.
function withoutNoise(line) {
  const words = [...(line?.words ?? [])]
  const edgeNoise = word => /^[|│¦]$/.test(word.text)
    || (!trusted(word) && (!/\d/.test(word.text) || (word.confidence < 40 && !/\d{2}|[$%]/.test(word.text))))
  while (words.length && edgeNoise(words[0])) words.shift()
  while (words.length && edgeNoise(words.at(-1))) words.pop()
  if (!words.some(word => trusted(word) && /[\da-z]/i.test(word.text))) return null
  const kept = words.map(word => trusted(word) ? word : { ...word, text: UNREADABLE })
  return { text: kept.map(word => word.text).join(' '), words: kept }
}

function lineBounds(line) {
  const boxes = line?.words?.map(word => word.bbox) ?? []
  if (!boxes.length || boxes.some(box => !box || !['x0', 'x1', 'y0', 'y1'].every(key => Number.isFinite(box[key]))
    || box.x1 <= box.x0 || box.y1 <= box.y0)) return null
  return {
    x0: Math.min(...boxes.map(box => box.x0)), x1: Math.max(...boxes.map(box => box.x1)),
    y0: Math.min(...boxes.map(box => box.y0)), y1: Math.max(...boxes.map(box => box.y1))
  }
}

// AUTO segmentation can read the entire date column before the amount column.
// Join only unambiguous horizontal neighbours; retain vertical cards when there is no right-hand column.
function pairInstallmentColumns(lines) {
  const entries = lines.map((line, index) => ({ line, index, box: lineBounds(line) })).filter(entry => entry.box)
  const dates = entries.filter(({ line }) => (ROW_DATE.test(line.text) || PARTIAL_ROW_DATE.test(line.text))
    && !installmentAmount(line.text) && !line.text.includes('$'))
  const amounts = entries.filter(({ line }) => installmentAmount(line.text)
    && INSTALLMENT_AMOUNT_CELL.test(line.text))
  const statuses = entries.filter(({ line }) => INSTALLMENT_STATUS.test(line.text))
  if (!dates.length || (!amounts.length && !statuses.length)) return lines
  const sameRow = (a, b) => Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
    >= Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5
  const matches = dates.map(date => ({
    ...date,
    amounts: amounts.filter(amount => amount.box.x0 > date.box.x1 && sameRow(date.box, amount.box))
  }))
  const result = [...lines]
  const top = Math.min(...dates.map(date => date.box.y0))
  const bottom = Math.max(...dates.map(date => date.box.y1))
  // Block sequential parsing from claiming an ambiguous right-column amount for a different date.
  for (const amount of amounts) {
    if (dates.some(date => amount.box.x0 > date.box.x1)
      && amount.box.y1 >= top && amount.box.y0 <= bottom) result[amount.index] = null
  }
  for (const date of matches) {
    if (date.amounts.length !== 1) continue
    const [amount] = date.amounts
    if (matches.filter(other => other.amounts.includes(amount)).length !== 1) continue
    result[date.index] = { ...date.line, text: `${date.line.text} ${amount.line.text}` }
    result[amount.index] = undefined
  }
  for (const date of matches) {
    const matchesStatus = statuses.filter(status => status.box.x0 > date.box.x1 && sameRow(date.box, status.box))
    if (matchesStatus.length !== 1) continue
    const [status] = matchesStatus
    if (matches.filter(other => other.box.x1 < status.box.x0 && sameRow(other.box, status.box)).length !== 1) continue
    if (/\b(?:paid|completed|unpaid|pending|due|upcoming|scheduled|overdue)\b/i.test(result[date.index].text)) continue
    result[date.index] = { ...result[date.index], text: `${result[date.index].text} ${status.line.text}` }
    result[status.index] = undefined
  }
  return result
}

// Low-confidence yearless dates are hints only: a full date must still be entered by the user.
function horizontalDateHints(rawLines, lines) {
  const result = [...lines]
  for (let index = 0; index + 1 < rawLines.length; index += 1) {
    const words = rawLines[index]?.words ?? []
    const amounts = rawLines[index + 1]?.words ?? []
    if (words.length < 4 || words.length !== amounts.length * 2) continue
    const pairs = amounts.map((amount, i) => {
      const month = words[i * 2]
      const day = words[i * 2 + 1]
      const monthIndex = MONTHS.findIndex(item => item === month.text.toLowerCase() || item.slice(0, 3) === month.text.toLowerCase())
      const value = Number(day.text)
      const dateBox = lineBounds({ words: [month, day] })
      const amountBox = lineBounds({ words: [amount] })
      if (!trusted(amount) || !/^\$\s*[\d,]+\.\d{2}$/.test(amount.text)
        || !dateBox || !amountBox || amountBox.y0 < dateBox.y0
        || amountBox.y0 - dateBox.y1 > (dateBox.y1 - dateBox.y0) * 2
        || amountBox.x1 < dateBox.x0 || amountBox.x0 > dateBox.x1) return null
      const date = monthIndex >= 0 && /^\d{1,2}$/.test(day.text) && isoDate(2000, monthIndex + 1, value)
        ? `${month.text} ${day.text}` : ''
      return { ...lines[index], text: `Installment ${i + 1} ${date} ${amount.text}` }
    })
    if (pairs.every(Boolean) && lines[index + 1] && pairs.length === amounts.length) {
      result[index] = pairs
      result[index + 1] = undefined
      index += 1
    }
  }
  return result.flat()
}

export function getReliableOcrLines(data, { paymentPlan = false } = {}) {
  const raw = (data.blocks ?? []).flatMap(block => block.paragraphs ?? [])
    .flatMap(paragraph => paragraph.lines ?? [])
  const filtered = raw.map(withoutNoise)
  const source = paymentPlan ? horizontalDateHints(raw, filtered) : filtered
  const lines = paymentPlan ? pairInstallmentColumns(source) : source
  return lines.flatMap((line, index) => {
    if (line === undefined) return []
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
