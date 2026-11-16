import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getReliableOcrLines, parseBillStatement, parseDebtStatement, parsePaymentPlanScan, validateStatementSuggestions } from './statementData.js'
import { electricScooterMarkerOcrData, electricScooterOcrData, homeDepotOcrData, loveseatActivityLines } from './statementOcrFixture.js'
import { flattenStatementBackground, getPdfTextLines, getStatementFileKind, MAX_STATEMENT_BYTES, statementCanvasScale } from './statementExtraction.js'
import { getInstallmentStatus } from './debtSchedule.js'

test('Loveseat Activity retains paid, pending and due rows with exact dates and provider balance', () => {
  const result = parsePaymentPlanScan(loveseatActivityLines)
  assert.equal(result.values.currentBalance, '197.38')
  assert.equal(result.values.name, 'Christopher Knight Loveseat')
  assert.equal(result.planTerms.count, '6')
  assert.equal(result.planTerms.firstDate, '2026-09-16')
  assert.deepEqual(result.installments.map(row => [row.dueDate, row.amount, getInstallmentStatus(row)]), [
    ['2026-09-16', '64.24', 'paid'],
    ['2026-10-16', '64.24', 'paid'],
    ['2026-11-13', '64.24', 'pending'],
    ['2026-12-13', '64.24', 'due'],
    ['2027-01-13', '64.24', 'due'],
    ['2027-02-13', '63.82', 'due']
  ])
  assert.equal(result.installments[2].paid, false)
  // A marker alone is not proof of completion; explicit pending text wins.
  const pending = parsePaymentPlanScan(['Activity', '\u2713 Nov 13, 2026', '$64.24 pending']).installments[0]
  assert.equal(getInstallmentStatus(pending), 'pending')
  assert.equal(pending.paid, false)
})

const scooterSchedule = Array.from({ length: 12 }, (_, index) => ({
  dueDate: index === 0 ? '2026-12-15' : `2027-${String(index).padStart(2, '0')}-15`,
  amount: index === 11 ? '52.36' : '52.42', paid: false
}))

test('dark-mode Electric Scooter timeline OCR yields all 12 dated installments, resolving the yearless first row', () => {
  for (const data of [electricScooterOcrData, electricScooterMarkerOcrData]) {
    const result = parsePaymentPlanScan(getReliableOcrLines(data))
    assert.deepEqual(result.installments, scooterSchedule)
    assert.deepEqual(result.planTerms, { count: '12', firstDate: '2026-12-15', frequency: 'monthly' })
    assert.equal(result.values.name, 'Electric Scooter')
    assert.equal(result.values.currentBalance, '628.98')
    assert.equal(result.values.totalInstallments, '12')
    assert.equal(result.values.nextPaymentDue, '2026-12-15')
    assert.equal(result.values.purchaseCategory, undefined)
  }
})

test('timeline rows without a usable date or amount are dropped and the autopay summary is not a row', () => {
  assert.deepEqual(parsePaymentPlanScan(['Activity', 'Dec 15', 'Jan 15 $52.42 due']).installments, [
    { dueDate: '', amount: '52.42', paid: false }
  ])
  assert.deepEqual(parsePaymentPlanScan([
    'Electric Scooter on Nov 15', '$628.98', 'Remaining balance', 'Autopay', '$52.42 due on Dec 15',
    'Jan 15, 2027', '$52.42 due', 'Feb 15, 2027', '[?] due'
  ]).installments, [
    { dueDate: '2027-01-15', amount: '52.42', paid: false },
    { dueDate: '2027-02-15', amount: '', paid: false }
  ])
  // A yearless row stays undated when its neighbours are not in chronological order.
  assert.equal(parsePaymentPlanScan(['Activity', 'Dec 15 $5.00', 'Mar 1, 2027 $5.00', 'Jan 1, 2027 $5.00']).installments[0].dueDate, '')
})

test('monthly activity timeline uses the item name, exact visible installments and adjusted final cents', () => {
  const dates = ['Dec 15, 2026', 'Jan 15, 2027', 'Feb 15, 2027', 'Mar 15, 2027',
    'Apr 15, 2027', 'May 15, 2027', 'Jun 15, 2027', 'Jul 15, 2027',
    'Aug 15, 2027', 'Sep 15, 2027', 'Oct 15, 2027', 'Nov 15, 2027']
  const lines = ['In progress', 'Electric Scooter on Nov 15', 'Remaining balance', '$628.98',
    'Autopay: $52.42', 'Next due date', 'December 15, 2026',
    '$52.42 due on December 15, 2026', 'Activity',
    ...dates.flatMap((date, index) => [`${date} due`, index === 11 ? '$52.36' : '$52.42'])]
  const result = parsePaymentPlanScan(lines)
  assert.equal(result.values.name, 'Electric Scooter')
  assert.equal(result.values.currentBalance, '628.98')
  assert.equal(result.values.nextPaymentAmount, '52.42')
  assert.equal(result.values.nextPaymentDue, '2026-12-15')
  assert.equal(result.values.purchaseCategory, undefined)
  assert.equal(result.values.totalInstallments, '12')
  assert.deepEqual(result.planTerms, { count: '12', firstDate: '2026-12-15', frequency: 'monthly' })
  assert.deepEqual(result.installments, dates.map((_, index) => ({
    dueDate: index === 0 ? '2026-12-15' : `2027-${String(index).padStart(2, '0')}-15`,
    amount: index === 11 ? '52.36' : '52.42', paid: false
  })))
  assert.equal(parseDebtStatement(lines).installments, undefined)
})

test('every-two-weeks activity timeline prioritizes rows over summary and preserves confident paid status', () => {
  const result = parsePaymentPlanScan([
    'In progress', 'Merchant: Example Store', 'Remaining balance: $75.03',
    'Next payment: $99 on December 1, 2026', 'Activity',
    'November 16, 2026 $25.00 Completed',
    'Payment due on November 30, 2026 $25.01',
    'December 14, 2026', '$25.01', 'Upcoming',
    '$25.01 due on December 28, 2026 Not paid'
  ])
  assert.equal(result.values.name, 'Example Store')
  assert.equal(result.values.nextPaymentDue, '2026-11-30')
  assert.equal(result.values.nextPaymentAmount, '25.01')
  assert.equal(result.values.minimumPayment, '25.01')
  assert.deepEqual(result.planTerms, { count: '4', firstDate: '2026-11-16', frequency: 'biweekly' })
  assert.deepEqual(result.installments.map(row => row.paid), [true, false, false, false])
  assert.equal(result.installments.length, 4)
})

test('payment plan cadence inference handles calendar periods and leaves irregular or incomplete dates for review', () => {
  for (const [frequency, dates] of [
    ['weekly', ['2026-12-15', '2026-12-22', '2026-12-29']],
    ['twice-monthly', ['2026-12-01', '2026-12-15', '2027-01-01', '2027-01-15']],
    ['quarterly', ['2026-12-15', '2027-03-15', '2027-06-15']],
    ['semiannual', ['2026-12-15', '2027-06-15', '2027-12-15']],
    ['annual', ['2026-12-15', '2027-12-15', '2028-12-15']],
    ['monthly', ['2027-01-31', '2027-02-28', '2027-03-31']],
    ['', ['2026-12-15', '2027-01-16', '2027-02-15']],
    ['', ['2026-12-15', 'Jan 15']]
  ]) {
    const result = parsePaymentPlanScan(['Activity', ...dates.map(date => `${date} $25.00 due`)])
    assert.equal(result.planTerms.frequency, frequency)
  }
})

test('partial activity timelines keep only visible rows without inferring missing amounts or category', () => {
  const result = parsePaymentPlanScan([
    'In progress', 'Electric Scooter', 'Remaining balance: $628.98', 'Number of installments: 12',
    'Activity', 'Dec 15, 2026 $52.42 due', 'Jan 15, 2027 $52.42 due', 'Feb 15, 2027 due'
  ])
  assert.equal(result.values.name, 'Electric Scooter')
  assert.equal(result.installments.length, 3)
  assert.equal(result.installments[2].amount, '')
  assert.equal(result.values.purchaseCategory, undefined)
  assert.deepEqual(result.planTerms, { count: '3', firstDate: '2026-12-15', frequency: 'monthly' })
  assert.equal(parsePaymentPlanScan(['In progress', 'Remaining balance: $25']).values.name, undefined)
  assert.deepEqual(parsePaymentPlanScan(['Autopay: $25 on Dec 15, 2026']).values, {
    minimumPayment: '25', nextPaymentAmount: '25', nextPaymentDue: '2026-12-15'
  })
})

test('payment plans keep exact unequal amounts, arbitrary counts, and explicit paid statuses', () => {
  for (const [provider, count] of [['Afterpay', 3], ['Klarna', 4], ['Affirm', 6], ['PayPal Pay Later', 7]]) {
    const lines = [provider, 'Merchant: Example Store', 'Purchase amount: $240.50', 'Remaining balance: $180.50', 'Category: Shopping',
      ...Array.from({ length: count }, (_, index) => `Installment ${index + 1} 2027-${String(index + 1).padStart(2, '0')}-16 $${index === count - 1 ? '30.50' : '30.00'} ${index === 0 ? 'Paid' : 'Unpaid'}`)]
    const result = parseDebtStatement(lines)
    assert.equal(result.values.provider, provider)
    assert.equal(result.values.merchant, 'Example Store')
    assert.equal(result.values.purchaseCategory, 'Shopping')
    assert.equal(result.values.purchaseAmount, '240.5')
    assert.equal(result.values.currentBalance, '180.5')
    assert.equal(result.installments.length, count)
    assert.deepEqual(result.installments[0], { dueDate: '2027-01-16', amount: '30', paid: true })
    assert.deepEqual(result.installments.at(-1), { dueDate: `2027-0${count}-16`, amount: '30.5', paid: false })
  }
})

test('installment OCR preserves incomplete rows and does not invent a year, amount, or category', () => {
  const result = parseDebtStatement([
    'Afterpay', 'Installment 1 11/12/2026 $20 Paid', 'Installment 2 2026-12-30',
    'Installment 3 $25 Upcoming', '2027-01-13', '$26.25', 'Completed'
  ])
  assert.deepEqual(result.installments, [
    { dueDate: '', amount: '20', paid: true },
    { dueDate: '2026-12-30', amount: '', paid: false },
    { dueDate: '', amount: '25', paid: false },
    { dueDate: '2027-01-13', amount: '26.25', paid: true }
  ])
  assert.equal(result.values.purchaseCategory, undefined)
  assert.deepEqual(parseDebtStatement(['Klarna', 'Nov 16', '$25', 'Completed', 'Nov 30 $30 Unpaid']).installments, [
    { dueDate: '', amount: '25', paid: true }, { dueDate: '', amount: '30', paid: false }
  ])
  assert.equal(parseDebtStatement(['Credit Card Statement', 'Next payment: $25 on November 16, 2026']).installments, undefined)
})

test('installment cards and PDF table rows populate exact dates, amounts and paid statuses', () => {
  for (const provider of ['Afterpay - Payment schedule', 'Klarna', 'PayPal Pay Later', 'Affirm']) {
    const result = parseDebtStatement([
      provider, 'Payment schedule', 'Payment 1 of 4', '16 November 2026', '$24.99', 'Completed',
      'Payment 2', 'November 30, 2026', '25.00', 'Upcoming',
      '2026-12-14 | 25.01 | Unpaid',
      'Payment 4: 2026-12-28 | $25.03 | Not paid',
      'Purchase date: November 1, 2026', 'Remaining balance: $75.04'
    ])
    assert.deepEqual(result.installments, [
      { dueDate: '2026-11-16', amount: '24.99', paid: true },
      { dueDate: '2026-11-30', amount: '25', paid: false },
      { dueDate: '2026-12-14', amount: '25.01', paid: false },
      { dueDate: '2026-12-28', amount: '25.03', paid: false }
    ])
  }
  assert.deepEqual(parseDebtStatement([
    'Afterpay', '$25.01 November 16, 2026 Paid', '25.02 November 30, 2026 Upcoming'
  ]).installments, [
    { dueDate: '2026-11-16', amount: '25.01', paid: true },
    { dueDate: '2026-11-30', amount: '25.02', paid: false }
  ])
})

test('partial installment cards keep missing or invalid values blank without borrowing the next payment', () => {
  const result = parseDebtStatement([
    'Klarna', 'Number of installments: 6',
    'Payment 1', '2026-11-16', 'Paid',
    'Payment 2 $25.00 Upcoming',
    '2026-12-14 $25.999 Unpaid',
    'Payment 4 2026-12-28 -$20.00',
    'Payment 5 2027-01-11 $20.00 $21.00',
    'Payment 6', 'Remaining balance', '$100'
  ])
  assert.deepEqual(result.installments, [
    { dueDate: '2026-11-16', amount: '', paid: true },
    { dueDate: '', amount: '25', paid: false },
    { dueDate: '2026-12-14', amount: '', paid: false },
    { dueDate: '2026-12-28', amount: '', paid: false },
    { dueDate: '2027-01-11', amount: '', paid: false },
    { dueDate: '', amount: '', paid: false }
  ])
})

test('summary dates on separate lines are not mistaken for incomplete installments', () => {
  const result = parseDebtStatement([
    'Afterpay', 'Purchase date', 'November 1, 2026',
    'Next payment date', 'November 16, 2026',
    'Remaining balance: $100'
  ])
  assert.equal(result.installments, undefined)
  assert.equal(result.values.nextPaymentDue, '2026-11-16')
})

test('ordinary bills extract only explicit fields and leave conflicting or ambiguous values for review', () => {
  assert.deepEqual(parseBillStatement([
    'Biller: City Electric', 'Amount due: $81.23', 'Due date: November 30, 2026', 'Category: Housing & Utilities'
  ]).values, { name: 'City Electric', amount: '81.23', dueDate: '2026-11-30', category: 'Housing & Utilities' })
  const result = parseBillStatement(['Amount due: $20', 'Total due: $21', 'Due date: 11/12/2026'])
  assert.deepEqual(result.values, {})
  assert.deepEqual(result.conflicts, ['amount'])
  assert.deepEqual(parseBillStatement([
    'City Electric', 'Amount due', '$81.23', 'Due date', 'November 30, 2026', 'Category', 'Housing & Utilities'
  ]).values, { name: 'City Electric', amount: '81.23', dueDate: '2026-11-30', category: 'Housing & Utilities' })
})

test('labeled statement fields extract exact amounts, complete dates, debt type and only the account suffix', () => {
  const result = parseDebtStatement([
    'Creditor: Example Bank', 'Credit Card Statement',
    'Account Number: 1234 5678 9012 0042', 'Credit Limit: $5,000.00',
    'Current Outstanding Balance: $1,234.56', 'Purchase APR: 24.99%',
    'Minimum Payment Due: $35.00', 'Payment Due Date: November 30, 2026'
  ])
  assert.deepEqual(result, {
    values: {
      name: 'Example Bank', type: 'Credit Card', accountLast4: '0042', creditLimit: '5000',
      currentBalance: '1234.56', interestRate: '24.99', minimumPayment: '35', nextPaymentDue: '2026-11-30'
    },
    missing: [], conflicts: []
  })
  assert.equal(JSON.stringify(result).includes('1234 5678 9012'), false)
  assert.deepEqual(validateStatementSuggestions(result.values), result.values)
})

test('missing, negative, credit, ambiguous and conflicting amounts are never guessed or made positive', () => {
  const result = parseDebtStatement([
    'Previous Balance: $500', 'Amount Due: $40', 'Available Credit: $900',
    'Current Balance: -$20.00', 'New Balance: $20.00 CR',
    'Minimum Payment Due: $0', 'Purchase APR: 19.99%', 'APR: 0.00%',
    'Credit Limit: $5,000', 'Credit Limit: $6,000', 'Due Date: 11/12/2026'
  ])
  assert.deepEqual(result.values, { minimumPayment: '0' })
  assert.deepEqual(result.conflicts, ['creditLimit', 'interestRate'])
  assert.ok(result.missing.includes('currentBalance'))
  assert.ok(result.missing.includes('nextPaymentDue'))
  assert.equal(Object.hasOwn(result.values, 'startingBalance'), false)
})

test('dates require a valid full year and do not infer locale for ambiguous slash dates', () => {
  for (const [source, expected] of [
    ['2028-02-29', '2028-02-29'], ['Nov 30, 2026', '2026-11-30'], ['11/30/2026', '2026-11-30'],
    ['2026-02-29', undefined], ['Nov 30', undefined], ['02/03/2026', undefined],
    ['30/11/2026', undefined], ['2026-13-01', undefined]
  ]) {
    assert.equal(parseDebtStatement([`Payment Due Date: ${source}`]).values.nextPaymentDue, expected)
  }
})

test('masked account suffixes preserve zeros and names never absorb full account numbers', () => {
  assert.equal(parseDebtStatement(['Account ending in 0012']).values.accountLast4, '0012')
  assert.equal(parseDebtStatement(['Card Number: **** **** **** 0042']).values.accountLast4, '0042')
  assert.equal(parseDebtStatement(['Account Last 4 Digits: 0000']).values.accountLast4, '0000')
  assert.equal(parseDebtStatement(['Creditor: 1234 5678 9012 0042']).values.name, undefined)
  assert.equal(parseDebtStatement(['Account Number: 12345']).values.accountLast4, undefined)
  assert.equal(parseDebtStatement(['Companywide Financial']).values.name, 'Companywide Financial')
})

test('low confidence OCR is excluded without joining a label to a value across an unreadable line', () => {
  const line = (text, confidence) => ({ text, words: [{ text, confidence }] })
  const lines = getReliableOcrLines({ blocks: [{ paragraphs: [{ lines: [
    line('Current Balance:', 99), line('$800.00', 79), line('$300.00', 99),
    line('Minimum Payment Due: $25', 95)
  ] }] }] })
  assert.deepEqual(lines, ['Current Balance:', '', '$300.00', 'Minimum Payment Due: $25'])
  assert.deepEqual(parseDebtStatement(lines).values, { minimumPayment: '25' })
  assert.deepEqual(getReliableOcrLines({}), [])
})

test('PDF text reconstructs rows without pairing balances with amounts from other columns', () => {
  const item = (str, x, y, width = 100) => ({ str, transform: [1, 0, 0, 1, x, y], width })
  const lines = getPdfTextLines([
    item('$25.00', 220, 650, 50), item('Minimum Payment Due:', 10, 650, 150),
    item('Balance:', 65, 700, 55), item('Current', 10, 700, 50), item('$800.12', 220, 700, 60)
  ])
  assert.deepEqual(parseDebtStatement(lines).values, { currentBalance: '800.12', minimumPayment: '25' })
  assert.deepEqual(parseDebtStatement(getPdfTextLines([
    item('Credit Limit:', 10, 700), item('Current Balance:', 300, 700),
    item('$5000', 10, 650), item('$800', 300, 650)
  ])).values, {})
  assert.deepEqual(parseDebtStatement(getPdfTextLines([
    item('Current Balance:', 300, 700), item('$5000', 10, 650)
  ])).values, {})
  assert.equal(parseDebtStatement(getPdfTextLines([
    item('Current Balance:', 10, 700), item('$800', 10, 650)
  ])).values.currentBalance, '800')
  assert.deepEqual(parseDebtStatement(getPdfTextLines([
    item('Purchase date', 10, 750), item('May 15, 2026', 10, 730),
    item('Current remaining balance', 10, 700), item('$296.74', 10, 680),
    item('Next payment date', 10, 650), item('November 16, 2026', 10, 630)
  ])).values, { currentBalance: '296.74', nextPaymentDue: '2026-11-16' })
})

test('file selection rejects oversized, empty and unsupported documents without loading engines', () => {
  for (const [name, type, expected] of [
    ['photo.jpg', 'image/jpeg', 'image'], ['image.HEIC', '', 'image'],
    ['statement.pdf', 'application/pdf', 'pdf'], ['statement.PDF', 'application/octet-stream', 'pdf']
  ]) assert.equal(getStatementFileKind({ name, type, size: 10 }), expected)
  for (const file of [
    { name: 'empty.pdf', type: 'application/pdf', size: 0 },
    { name: 'large.pdf', type: 'application/pdf', size: MAX_STATEMENT_BYTES + 1 },
    { name: 'script.svg', type: 'image/svg+xml', size: 10 },
    { name: 'file.txt', type: 'text/plain', size: 10 }
  ]) assert.throws(() => getStatementFileKind(file), { name: 'StatementScanError' })
})

test('edited suggestions validate exact suffixes, money, dates and explicit type without silent rounding', () => {
  assert.deepEqual(validateStatementSuggestions({ currentBalance: '0.01', accountLast4: '0012' }), { currentBalance: '0.01', accountLast4: '0012' })
  for (const values of [
    {}, { currentBalance: '-1' }, { currentBalance: '1.234' }, { accountLast4: '12345' },
    { accountLast4: '012' }, { accountLast4: '1234567890123456' },
    { interestRate: 'NaN' }, { nextPaymentDue: '2026-02-30' }, { type: 'Unknown' }
  ]) assert.throws(() => validateStatementSuggestions(values))
})

test('Home Depot installment totals remain distinct and inconsistent totals are flagged, not recalculated', () => {
  const result = parseDebtStatement([
    'Creditor: The Home Depot', 'Purchase amount: $1,568.00', 'Total interest: $121.90',
    'APR: 24.99%', 'Total repayment amount: $1,780.64', 'Already paid: $1,483.90',
    'Remaining balance: $296.74', 'Payments completed: 5 of 6',
    'Next scheduled payment: $296.74 on November 16, 2026'
  ])
  assert.deepEqual(result.values, {
    name: 'The Home Depot', currentBalance: '296.74', interestRate: '24.99', minimumPayment: '296.74', nextPaymentDue: '2026-11-16',
    purchaseAmount: '1568', totalRepayment: '1780.64', totalInterest: '121.9', amountAlreadyPaid: '1483.9',
    totalInstallments: '6', completedInstallments: '5', nextPaymentAmount: '296.74', type: 'Other'
  })
  assert.equal(result.values.creditLimit, undefined)
  assert.equal(result.values.startingBalance, undefined)
  assert.equal(result.values.paymentHistory, undefined)
  assert.match(result.warnings[0], /does not match/)
  assert.deepEqual(validateStatementSuggestions(result.values), result.values)
})

test('screenshot-style OCR maps separate Home Depot labels and values without needing every debt field', () => {
  const result = parseDebtStatement([
    'The Home Depot\n', 'Purchase date\n\n', 'May 15, 2026\n\n',
    'Purchase amount\n', '$1,568.00\n\n', 'Total interest\n\n', '$121.90\n\n',
    'APR\n\n', '24.99%\n\n', 'Total repayment amount\n', '$1,780.64\n\n',
    'Amount already paid\n', '$1,483.90\n\n', 'Current remaining balance\n', '$296.74\n\n',
    'Next scheduled payment\n', '$296.74\n\n', 'Next payment date\n', 'November 16, 2026\n\n',
    '5 of 6 payments completed\n'
  ])
  assert.deepEqual(result.values, {
    name: 'The Home Depot', currentBalance: '296.74', interestRate: '24.99', minimumPayment: '296.74', nextPaymentDue: '2026-11-16',
    purchaseAmount: '1568', totalRepayment: '1780.64', totalInterest: '121.9', amountAlreadyPaid: '1483.9',
    totalInstallments: '6', completedInstallments: '5', nextPaymentAmount: '296.74', type: 'Other'
  })
  for (const key of ['accountLast4', 'creditLimit']) {
    assert.ok(result.missing.includes(key))
    assert.equal(result.values[key], undefined)
  }
  assert.deepEqual(validateStatementSuggestions(result.values), result.values)
})

test('one or two reliable fields survive incomplete statements and unrelated unreadable values', () => {
  for (const [lines, values] of [
    [['Current remaining balance', '$296.74'], { currentBalance: '296.74' }],
    [['APR: 24.99%', 'Credit Limit: unreadable'], { interestRate: '24.99' }],
    [['Current remaining balance: $296.74', 'Next payment date: November 16, 2026', 'Account: ???'],
      { currentBalance: '296.74', nextPaymentDue: '2026-11-16' }]
  ]) {
    const result = parseDebtStatement(lines)
    assert.deepEqual(result.values, values)
    assert.deepEqual(result.conflicts, [])
    assert.ok(result.missing.length)
  }
})

test('purchase, paid and repayment totals never become an outstanding balance, credit limit or minimum payment', () => {
  const result = parseDebtStatement([
    'The Home Depot', 'Purchase date', 'May 15, 2026',
    'Purchase amount', '$1,568.00', 'Total repayment amount', '$1,780.64',
    'Amount already paid', '$1,483.90', 'Next scheduled payment', '$40.00',
    'Next payment date', 'November 16, 2026', 'Progress: 5 of 6 payments completed'
  ])
  for (const key of ['currentBalance', 'creditLimit', 'accountLast4']) {
    assert.equal(result.values[key], undefined)
  }
  assert.equal(result.values.minimumPayment, '40')
  assert.equal(result.values.purchaseAmount, '1568')
  assert.equal(result.values.amountAlreadyPaid, '1483.9')
  assert.equal(result.values.nextPaymentAmount, '40')
  assert.equal(result.values.nextPaymentDue, '2026-11-16')
  assert.equal(parseDebtStatement(['Purchase date: May 15, 2026']).values.nextPaymentDue, undefined)
  assert.equal(parseDebtStatement(['Current remaining balance', 'Purchase amount', '$1,568.00']).values.currentBalance, undefined)
  assert.equal(parseDebtStatement(['Current remaining balance', '', '$296.74']).values.currentBalance, undefined)
})

test('unrecognized documents and generic financial headings do not invent creditor names or amounts', () => {
  for (const lines of [
    ['A walk in the park', 'Thank you', '$296.74', 'May 15, 2026'],
    ['Payment summary', 'Purchase date', 'May 15, 2026'],
    ['Statement details', 'Current remaining balance', 'Unreadable'],
    ['Due soon', 'Current remaining balance', 'Unreadable'],
    ['Welcome back', 'Purchase date', 'May 15, 2026'],
    ['5 of 6 pages', 'Purchase history']
  ]) {
    assert.deepEqual(parseDebtStatement(lines).values, {})
  }
})

// Line structure reported from on-device OCR of a Home Depot installment screenshot (synthetic values).
const homeDepotRealOcr = [
  'The Home Depot', "5 of 6 You've paid Remaining", 'Paid $1,483.90 $296.74',
  '$296.74 scheduled for Nov 16 Make a Payment', 'Purchase date May 15, 2026',
  'Purchase amount $1,568.00', 'Total interest $121.90 (APR 24.99%)', 'Total amount $1,780.64'
]

test('real OCR column layout pairs Remaining with its amount and resolves the due year from the plan', () => {
  const result = parseDebtStatement(homeDepotRealOcr.map(line => `${line}\n`))
  assert.deepEqual(result.values, {
    name: 'The Home Depot', type: 'Other', currentBalance: '296.74', interestRate: '24.99', minimumPayment: '296.74',
    nextPaymentDue: '2026-11-16', purchaseAmount: '1568', totalRepayment: '1780.64', totalInterest: '121.9',
    amountAlreadyPaid: '1483.9', nextPaymentAmount: '296.74', completedInstallments: '5', totalInstallments: '6'
  })
  for (const key of ['creditLimit', 'accountLast4', 'startingBalance']) assert.equal(result.values[key], undefined)
  assert.deepEqual(validateStatementSuggestions(result.values), result.values)
})

test('OCR word positions pair column captions with the amounts directly below them', () => {
  const word = (text, x) => ({ text, confidence: 95, bbox: { x0: x - 20, x1: x + 20 } })
  const lines = getReliableOcrLines({ blocks: [{ paragraphs: [{ lines: [
    { text: 'The Home Depot', confidence: 95, words: [word('The', 50), word('Home', 100), word('Depot', 150)] },
    { text: "You've paid Remaining", confidence: 95, words: [word("You've", 80), word('paid', 120), word('Remaining', 300)] },
    { text: '$1,483.90 $296.74', confidence: 95, words: [word('$1,483.90', 100), word('$296.74', 300)] }
  ] }] }] })
  assert.ok(lines.includes('Remaining $296.74'))
  const result = parseDebtStatement(lines)
  assert.equal(result.values.currentBalance, '296.74')
  assert.equal(result.values.amountAlreadyPaid, '1483.9')
})

test('real Tesseract word output keeps a heading beside a logo, reads 50f6 as 5 of 6 and never cross-pairs label rows', () => {
  const lines = getReliableOcrLines(homeDepotOcrData)
  assert.ok(lines.includes('The Home Depot'))
  assert.ok(lines.includes('Remaining $296.74'))
  assert.ok(!lines.some(line => /^(?:Purchase amount|Total interest) \$(?:121\.90|1,780\.64)$/.test(line)))
  assert.deepEqual(parseDebtStatement(lines).values, {
    name: 'The Home Depot', type: 'Other', currentBalance: '296.74', interestRate: '24.99', minimumPayment: '296.74',
    nextPaymentDue: '2026-11-16', purchaseAmount: '1568', totalRepayment: '1780.64', totalInterest: '121.9',
    amountAlreadyPaid: '1483.9', nextPaymentAmount: '296.74', completedInstallments: '5', totalInstallments: '6'
  })
  const word = (text, confidence) => ({ text, confidence })
  const noisy = getReliableOcrLines({ blocks: [{ paragraphs: [{ lines: [
    { text: 'Total interest $121.9O', words: [word('Total', 96), word('interest', 96), word('$121.9O', 60)] },
    { text: 'Remaining $296.74', words: [word('Remaining', 96), word('$296.74', 70)] }
  ] }] }] })
  assert.deepEqual(noisy, ['Total interest [?]', 'Remaining [?]'])
  assert.deepEqual(parseDebtStatement(noisy).values, {})
  assert.deepEqual(parseDebtStatement([...noisy, '$296.74']).values, {})
  assert.equal(parseDebtStatement(['50f6 payments', '$1,483.90']).values.completedInstallments, '5')
  assert.equal(parseDebtStatement(['50f6 $1,483.90']).values.completedInstallments, undefined)
})

test('downscaled iPhone photo-picker OCR keeps confident values beside lower-confidence words', () => {
  const ocr = rows => ({ blocks: [{ paragraphs: [{ lines: rows.map(words => ({
    text: words.map(([text]) => text).join(' '),
    words: words.map(([text, confidence, x0, x1]) => ({ text, confidence, bbox: { x0, x1 } }))
  })) }] }] })
  // Real Tesseract words from a half-size JPEG, as the iOS picker's "Large" option can provide.
  const half = ocr([
    [['3:03', 96, 49, 95], ['5G', 96, 496, 522]],
    [['Payment', 96, 213, 317], ['plan', 95, 326, 376]],
    [['[|', 70, 44, 99], ['The', 96, 117, 170], ['Home', 96, 181, 262], ['Depot', 95, 273, 355]],
    [["You've", 95, 256, 312], ['paid', 95, 319, 354], ['Remaining', 95, 422, 512]],
    [['50f6', 77, 100, 170], ['$1,483.90', 95, 256, 375], ['$296.74', 88, 421, 517]],
    [['Paid', 96, 117, 153]],
    [['$296.74', 96, 49, 129], ['scheduled', 96, 136, 237], ['for', 96, 245, 271], ['Nov', 96, 279, 317], ['16', 96, 325, 348]],
    [['Purchase', 96, 50, 142], ['date', 96, 150, 192], ['May', 96, 407, 448], ['15,', 96, 456, 484], ['2026', 96, 492, 541]],
    [['Purchase', 96, 50, 142], ['amount', 96, 150, 224], ['$1,568.00', 96, 442, 541]],
    [['Total', 96, 48, 94], ['interest', 96, 103, 175], ['$121.90', 96, 311, 391], ['(APR', 95, 399, 451], ['24.99%)', 96, 459, 541]],
    [['Total', 95, 48, 94], ['amount', 96, 103, 177], ['$1,780.64', 96, 442, 541]]
  ])
  const values = parseDebtStatement(getReliableOcrLines(half)).values
  assert.equal(values.name, 'The Home Depot')
  assert.equal(values.currentBalance, '296.74')
  assert.equal(values.amountAlreadyPaid, '1483.9')
  assert.equal(values.nextPaymentDue, '2026-11-16')
  assert.equal(values.interestRate, '24.99')
  assert.equal(values.purchaseAmount, '1568')

  // Smaller images: an uncertain paid amount is masked without shifting Remaining or losing the balance.
  const third = ocr([
    [["You've", 77, 256, 312], ['paid', 90, 319, 354], ['Remaining', 92, 422, 512]],
    [['5', 85, 100, 115], ['of', 85, 120, 140], ['6', 85, 145, 170], ['$1,483.90', 73, 256, 375], ['$296.74', 82, 421, 517]]
  ])
  const small = parseDebtStatement(getReliableOcrLines(third)).values
  assert.equal(small.currentBalance, '296.74')
  assert.equal(small.amountAlreadyPaid, undefined)

  // A masked amount never lends its column to a neighbour.
  const masked = ocr([
    [["You've", 95, 256, 312], ['paid', 95, 319, 354], ['Remaining', 95, 422, 512]],
    [['$1,483.90', 95, 256, 375], ['$296.74', 60, 421, 517]]
  ])
  const guarded = parseDebtStatement(getReliableOcrLines(masked)).values
  assert.equal(guarded.currentBalance, undefined)
  assert.notEqual(guarded.amountAlreadyPaid, '296.74')
})

test('split columns and yearless due dates stay blank when the association is not unambiguous', () => {
  const mismatched = parseDebtStatement(["You've paid Remaining", '$1,483.90 $296.74 $12.00'])
  assert.equal(mismatched.values.currentBalance, undefined)
  assert.equal(mismatched.values.amountAlreadyPaid, undefined)
  assert.equal(parseDebtStatement(['$296.74 scheduled for Nov 16']).values.nextPaymentDue, undefined)
  assert.equal(parseDebtStatement(['Purchase date May 15, 2026', '$296.74 scheduled for Nov 16']).values.nextPaymentDue, undefined)
  assert.equal(parseDebtStatement([
    '5 of 24 payments', 'Purchase date May 15, 2026', '$296.74 scheduled for Nov 16'
  ]).values.nextPaymentDue, undefined)
  assert.equal(parseDebtStatement([
    '5 of 6 payments', 'Purchase date Dec 15, 2026', '$296.74 scheduled for Nov 16'
  ]).values.nextPaymentDue, undefined)
})

test('caption amounts, scheduled payments and embedded APRs do not override explicit or conflicting values', () => {
  assert.equal(parseDebtStatement(['$296.74', 'Remaining', '$1,483.90']).values.currentBalance, '296.74')
  assert.equal(parseDebtStatement(['Remaining', '$296.74']).values.currentBalance, '296.74')
  assert.equal(parseDebtStatement(['Total amount due $50.00']).values.totalRepayment, undefined)
  assert.equal(parseDebtStatement(['Minimum Payment Due: $35.00', '$296.74 scheduled for Nov 30, 2026']).values.minimumPayment, '35')
  assert.equal(parseDebtStatement(['$296.74 scheduled for Nov 30, 2026']).values.nextPaymentDue, '2026-11-30')
  assert.equal(parseDebtStatement(['Purchase APR: 19.99%', 'Fee $1.00 (APR 24.99%)']).values.interestRate, undefined)
})

function shadedPhoto(width, height, shade) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    pixels[i] = pixels[i + 1] = pixels[i + 2] = shade(x, y)
    pixels[i + 3] = 255
  }
  return pixels
}
const gray = (pixels, width, x, y) => pixels[(y * width + x) * 4]

test('photographed statements with shaded backgrounds are flattened so text is separable from paper everywhere', () => {
  const width = 256
  const height = 128
  // Bright centre fading to a dark edge, like a phone photo of a laptop screen; text is drawn 70% as bright as its surroundings.
  const paper = x => 220 - Math.abs(x - 128) * 0.6
  const isText = (x, y) => y >= 60 && y < 68 && x % 16 < 4
  const pixels = shadedPhoto(width, height, (x, y) => isText(x, y) ? paper(x) * 0.7 : paper(x))
  assert.ok(gray(pixels, width, 2, 10) < gray(pixels, width, 128, 61), 'edge paper starts darker than centre text')
  flattenStatementBackground(pixels, width, height)
  for (const x of [0, 2, 64, 128, 200, 254]) assert.ok(gray(pixels, width, x, 10) >= 220, `paper at x=${x} becomes near-white`)
  for (const x of [1, 65, 129, 241]) assert.ok(gray(pixels, width, x, 63) <= 190, `text at x=${x} stays dark`)
})

test('dark-mode screenshots are inverted to dark text on a white background before reading', () => {
  const isText = (x, y) => y > 30 && y < 36 && x % 8 < 3
  const pixels = shadedPhoto(64, 64, (x, y) => isText(x, y) ? 235 : 28)
  flattenStatementBackground(pixels, 64, 64)
  assert.ok(gray(pixels, 64, 4, 10) >= 240, 'dark background becomes white')
  assert.ok(gray(pixels, 64, 1, 33) <= 40, 'light text becomes dark')
})

test('small screenshots are enlarged for reading within the pixel budget, large ones are not', () => {
  assert.equal(statementCanvasScale(512, 768), 2)
  assert.ok(Math.abs(statementCanvasScale(1024, 1536) * Math.sqrt(1024 * 1536) - 2000) < 1)
  assert.equal(statementCanvasScale(1290, 2796), 1)
  assert.ok(statementCanvasScale(4000, 3000) < 1)
})
