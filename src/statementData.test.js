import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getReliableOcrLines, parseDebtStatement, validateStatementSuggestions } from './statementData.js'
import { homeDepotOcrData } from './statementOcrFixture.js'
import { getPdfTextLines, getStatementFileKind, MAX_STATEMENT_BYTES } from './statementExtraction.js'

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
  assert.deepEqual(noisy, ['', ''])
  assert.equal(parseDebtStatement(['50f6 payments', '$1,483.90']).values.completedInstallments, '5')
  assert.equal(parseDebtStatement(['50f6 $1,483.90']).values.completedInstallments, undefined)
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
