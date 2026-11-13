import {
  classifyTransactions,
  getClassificationFlags,
  getSpendingEntries,
  netSpending
} from './transactionRules.js'

export const MAX_CHART_SLICES = 12
export const REMAINING_CATEGORIES_LABEL = 'Remaining categories'

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function getMonthKey(date) {
  return typeof date === 'string' && MONTH_PATTERN.test(date.slice(0, 7)) ? date.slice(0, 7) : null
}

export function shiftMonth(month, delta) {
  const [year, monthNumber] = month.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

export function formatMonthLabel(month) {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

// The selectable range covers every month that has a transaction plus the current month.
export function getMonthBounds(transactions, currentMonth) {
  const months = transactions.map(transaction => getMonthKey(transaction.date)).filter(Boolean)
  return {
    first: [currentMonth, ...months].reduce((a, b) => (a < b ? a : b)),
    last: [currentMonth, ...months].reduce((a, b) => (a > b ? a : b))
  }
}

// Whole-number percentages that always add up to exactly 100 (largest remainder method).
function wholePercentages(centsList) {
  const total = centsList.reduce((sum, cents) => sum + cents, 0)
  if (total === 0) return centsList.map(() => 0)
  const floors = centsList.map(cents => Math.floor((cents * 100) / total))
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0)
  // Integer remainders keep exact ties in list order instead of depending on floating-point noise.
  const order = centsList
    .map((cents, index) => ({ index, remainder: (cents * 100) % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index)
  for (const { index } of order) {
    if (remaining <= 0) break
    floors[index] += 1
    remaining -= 1
  }
  return floors
}

// Net spending for one month from the shared classification rules (transactionRules.js), the same rules
// Budgets and Daily Spending use: purchases in active expense categories plus uncategorized purchases
// (shown as "Uncategorized"), reduced by refunds recorded under the same category. Transfers, debt
// payments, duplicate links, and income are never spending. Cleared status is not used.
export function getSpendingByCategory({ transactions, month, categories, accounts = [], maxSlices = MAX_CHART_SLICES }) {
  const classified = classifyTransactions({ transactions, categories, accounts })
  const net = netSpending(getSpendingEntries(classified.filter(record => getMonthKey(record.date) === month)))

  const sorted = Object.entries(net.byCategory)
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents || a.category.localeCompare(b.category))

  const visible = sorted.length > maxSlices
    ? [
        ...sorted.slice(0, maxSlices - 1),
        {
          category: REMAINING_CATEGORIES_LABEL,
          cents: sorted.slice(maxSlices - 1).reduce((sum, item) => sum + item.cents, 0),
          isGroup: true,
          count: sorted.length - (maxSlices - 1)
        }
      ]
    : sorted

  const totalCents = net.totalCents
  const percents = wholePercentages(visible.map(item => item.cents))
  const items = visible.map((item, index) => ({
    category: item.category,
    amount: item.cents / 100,
    share: totalCents === 0 ? 0 : item.cents / totalCents,
    percent: percents[index],
    ...(item.isGroup ? { isGroup: true, count: item.count } : {})
  }))

  return {
    month,
    total: totalCents / 100,
    items,
    refundTotal: net.appliedRefundCents / 100,
    unmatchedRefundTotal: net.unmatchedRefundCents / 100
  }
}

// Arc lengths for a doughnut drawn as stroked circle segments around a circle of the given radius.
export function getDoughnutSegments(items, radius, gap = 1.2) {
  const circumference = 2 * Math.PI * radius
  const spacing = items.length > 1 ? gap : 0
  let offset = 0
  return items.map(item => {
    const length = item.share * circumference
    const segment = {
      category: item.category,
      dash: Math.max(length - spacing, 0.5),
      rest: circumference,
      offset: -offset
    }
    offset += length
    return segment
  })
}

function parseHex(color) {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color ?? '').trim())
  if (!match) return [255, 255, 255]
  const hex = match[1].length === 3 ? [...match[1]].map(char => char + char).join('') : match[1]
  return [0, 2, 4].map(start => parseInt(hex.slice(start, start + 2), 16))
}

export function relativeLuminance(color) {
  const [r, g, b] = parseHex(color).map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(colorA, colorB) {
  const [lighter, darker] = [relativeLuminance(colorA), relativeLuminance(colorB)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

function hslToHex(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = lightness - chroma / 2
  const [r, g, b] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x]
  return `#${[r, g, b].map(value => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`
}

// Hues alternate between warm and cool so neighboring slices are easy to tell apart.
const CHART_HUES = [212, 28, 145, 285, 350, 50, 175, 320, 95, 240, 12, 195]
const MIN_CHART_CONTRAST = 3.2

// Finds the lightness closest to a pleasant mid-tone that still reaches the minimum contrast against
// the card color: darker colors on light cards, lighter colors on dark cards.
function readableColor(hue, saturation, cardColor) {
  const goDarker = relativeLuminance(cardColor) > 0.18
  let best = hslToHex(hue, saturation, goDarker ? 0 : 1)
  for (let step = 0; step <= 100; step += 1) {
    const lightness = goDarker ? 0.62 - step * 0.0062 : 0.38 + step * 0.0062
    const candidate = hslToHex(hue, saturation, Math.min(Math.max(lightness, 0), 1))
    if (contrastRatio(candidate, cardColor) >= MIN_CHART_CONTRAST) return candidate
    best = candidate
  }
  return best
}

// One readable color per list item; the merged "Remaining categories" group is neutral gray.
export function getChartColors(items, cardColor) {
  const colors = CHART_HUES.map(hue => readableColor(hue, 0.62, cardColor))
  const neutral = readableColor(0, 0, cardColor)
  return items.map((item, index) => (item.isGroup ? neutral : colors[index % colors.length]))
}

// Earned income versus purchase spending for one month, from recorded account transactions only (never
// scheduled bills, income schedules, or forecasts), using the same classification as Budgets:
// - Income: money in that is not a refund, transfer, debt payment, or credit on a credit card account.
// - Expenses: the same net purchase spending as Spending by Category (refunds reduce it).
// - Debt payments (including credit card payments) are reported separately, because the purchases they pay
//   for are already counted as expenses. Refunds that match no spending this month are reported separately
//   too; they are neither income nor expenses.
export function getIncomeVsExpenses({ transactions, month, categories, accounts = [] }) {
  const inMonth = classifyTransactions({ transactions, categories, accounts }).filter(record => getMonthKey(record.date) === month)
  const net = netSpending(getSpendingEntries(inMonth))
  const incomeCents = inMonth.filter(record => record.kind === 'income').reduce((sum, record) => sum + record.cents, 0)
  const debtPaymentCents = 0 - inMonth.filter(record => record.kind === 'debt-payment').reduce((sum, record) => sum + record.signedCents, 0)
  return {
    month,
    income: incomeCents / 100,
    expenses: net.totalCents / 100,
    net: (incomeCents - net.totalCents) / 100,
    debtPayments: debtPaymentCents / 100,
    refundTotal: net.appliedRefundCents / 100,
    unmatchedRefundTotal: net.unmatchedRefundCents / 100,
    hasActivity: incomeCents > 0 || net.totalCents > 0 || debtPaymentCents !== 0 || net.unmatchedRefundCents > 0
  }
}

// Transactions in the month whose classification is a default rather than a certainty. Nothing is changed.
export function getReportFlags({ transactions, month, categories, accounts = [] }) {
  const classified = classifyTransactions({ transactions, categories, accounts })
  return getClassificationFlags(classified, date => getMonthKey(date) === month)
}

// Bar lengths relative to the larger amount, with a minimum so a small nonzero amount stays visible.
export function getBarShares(income, expenses, minimum = 0.02) {
  const largest = Math.max(income, expenses)
  const share = value => (value <= 0 || largest <= 0 ? 0 : Math.max(value / largest, minimum))
  return { income: share(income), expenses: share(expenses) }
}

export function getIncomeExpenseColors(cardColor) {
  return {
    income: readableColor(145, 0.62, cardColor),
    expenses: readableColor(8, 0.68, cardColor)
  }
}
