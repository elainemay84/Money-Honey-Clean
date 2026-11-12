import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BILL_STORAGE_KEY,
  createIncomeTransaction,
  createBillId,
  getIncomeOccurrences,
  getIncomeSummary,
  getPaydayIncomeSummary,
  getScheduleViewData,
  getScheduleSummary,
  linkIncomeToTransaction,
  loadBillData,
  getBillOccurrences,
  getBillOccurrencesInRange,
  loadIncomeSchedules,
  getMonthBillTotals,
  getPaydayBillSummary,
  getPaySchedulePeriod,
  loadBills,
  loadPaySchedule,
  saveBills,
  savePaySchedule,
  saveIncomeSchedules,
  updateIncomeStatus,
  updateBillPayment,
  updateBillOccurrenceSkip,
  updateScheduleOccurrence
} from './billData.js'

function bill(overrides = {}) {
  return {
    id: 1,
    name: 'Test bill',
    amount: 50,
    dueDate: '2026-04-01',
    frequency: 'monthly',
    autopay: false,
    accountId: null,
    paymentHistory: [],
    ...overrides
  }
}

function month(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex, 1))
}

test('recurring bills generate the correct weekly, biweekly, monthly, quarterly, and yearly dates', () => {
  const bills = [
    bill({ id: 1, dueDate: '2026-04-06', frequency: 'weekly' }),
    bill({ id: 2, dueDate: '2026-04-03', frequency: 'biweekly' }),
    bill({ id: 3, dueDate: '2026-01-31', frequency: 'monthly' }),
    bill({ id: 4, dueDate: '2026-01-31', frequency: 'quarterly' }),
    bill({ id: 5, dueDate: '2024-02-29', frequency: 'yearly' })
  ]

  assert.deepEqual(
    getBillOccurrences(bills, month(2026, 3)).map(item => [item.id, item.dueDate]),
    [
      [2, '2026-04-03'],
      [1, '2026-04-06'],
      [1, '2026-04-13'],
      [2, '2026-04-17'],
      [1, '2026-04-20'],
      [1, '2026-04-27'],
      [3, '2026-04-30'],
      [4, '2026-04-30']
    ]
  )

  assert.deepEqual(
    getBillOccurrences([bills[4]], month(2025, 1)).map(item => item.dueDate),
    ['2025-02-28']
  )
})

test('one-time due dates and calendar month boundaries are calculated accurately', () => {
  const marchBill = bill({ dueDate: '2026-03-01', frequency: 'one-time' })
  const aprilBill = bill({ id: 2, dueDate: '2026-04-01', frequency: 'one-time' })

  assert.deepEqual(getBillOccurrences([marchBill, aprilBill], month(2026, 2)).map(item => item.dueDate), ['2026-03-01'])
  assert.deepEqual(getBillOccurrences([marchBill, aprilBill], month(2026, 3)).map(item => item.dueDate), ['2026-04-01'])
  assert.equal(month(2026, 2).getUTCDay(), 0)
  assert.equal(new Date(Date.UTC(2026, 2 + 1, 0)).getUTCDate(), 31)
})

test('skipped debt installments persist once, stay unpaid, and can be restored without changing recurrence', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
  const original = bill({
    debtId: 7,
    dueDate: '2026-11-08',
    frequency: 'monthly',
    paymentHistory: []
  })
  const datesBeforeSkip = getBillOccurrencesInRange(
    [original],
    '2026-11-01',
    '2027-01-31'
  ).map(item => item.dueDate)
  const skipped = updateBillOccurrenceSkip(original, '2026-11-08', true, '2026-11-07T12:00:00Z')
  const duplicate = updateBillOccurrenceSkip(skipped, '2026-11-08', true, '2026-11-07T12:01:00Z')
  assert.equal(duplicate.paymentHistory.length, 1)
  assert.equal(duplicate.dueDate, '2026-11-08')
  assert.equal(duplicate.paymentHistory[0].skipped, true)
  saveBills([skipped], storage)
  const reloaded = loadBills([], storage)[0]
  assert.deepEqual(reloaded.paymentHistory, skipped.paymentHistory)

  const occurrence = getBillOccurrences(
    [reloaded],
    month(2026, 10)
  )[0]
  assert.equal(occurrence.paid, false)
  assert.equal(occurrence.skipped, true)
  assert.equal(getBillOccurrences([reloaded], month(2026, 11))[0].dueDate, '2026-12-08')
  assert.deepEqual(
    getBillOccurrencesInRange([reloaded], '2026-11-01', '2027-01-31')
      .map(item => item.dueDate),
    datesBeforeSkip
  )

  const restored = updateBillOccurrenceSkip(
    reloaded,
    '2026-11-08',
    false,
    '2026-11-08T12:00:00Z'
  )
  const restoredOccurrence = getBillOccurrences([restored], month(2026, 10))[0]
  assert.equal(restoredOccurrence.paid, false)
  assert.equal(restoredOccurrence.skipped, false)
  assert.equal(restored.paymentHistory.length, 2)
  assert.equal(restored.paymentHistory[0].skipped, true)
  assert.equal(restored.paymentHistory[1].skipped, false)
  assert.equal(restored.dueDate, '2026-11-08')
  assert.deepEqual(
    getBillOccurrencesInRange([restored], '2026-11-01', '2027-01-31')
      .map(item => item.dueDate),
    datesBeforeSkip
  )
})

test('linked transactions control clearing while paid history remains a separate completion state', () => {
  const due = bill({ dueDate: '2026-04-03', amount: 70, accountId: 1 })
  const unpaid = bill({ id: 2, name: 'Water', dueDate: '2026-04-04', amount: 35, accountId: 1 })
  const markedPaid = updateBillPayment(due, due.dueDate, true, '2026-04-03T12:00:00.000Z')
  const linkedTransactions = [{
    id: 8,
    accountId: 1,
    name: due.name,
    amount: -70,
    date: due.dueDate,
    cleared: true,
    linkedOccurrenceType: 'bill',
    linkedOccurrenceId: `bill:${due.id}:${due.dueDate}`
  }]
  const occurrences = getBillOccurrences([markedPaid, unpaid], month(2026, 3), linkedTransactions)

  assert.deepEqual(occurrences.map(item => item.paid), [true, false])
  assert.equal(occurrences[0].cleared, true)
  assert.deepEqual(getMonthBillTotals(occurrences, '2026-04-01'), {
    dueSoon: 35,
    paid: 70,
    remaining: 35
  })

  const markedUnpaid = updateBillPayment(markedPaid, due.dueDate, false, '2026-04-04T12:00:00.000Z')
  assert.equal(getBillOccurrences([markedUnpaid], month(2026, 3))[0].paid, false)
  assert.equal(markedUnpaid.paymentHistory.length, 2)
})

test('persisted paid and received history remains completed without conflating cleared state', () => {
  const paidBill = bill({
    id: 21,
    dueDate: '2026-04-03',
    paymentHistory: [{ dueDate: '2026-04-03', paid: true }]
  })
  const clearedOnlyBill = bill({
    id: 22,
    dueDate: '2026-04-04',
    paymentHistory: [{ dueDate: '2026-04-04', cleared: true }]
  })
  const income = {
    id: 23,
    name: 'Paycheck',
    amount: 1200,
    dueDate: '2026-04-03',
    frequency: 'one-time',
    paymentHistory: [{ dueDate: '2026-04-03', status: 'received' }]
  }

  const bills = getBillOccurrences(
    [paidBill, clearedOnlyBill],
    month(2026, 3)
  )
  const [received] = getIncomeOccurrences([income], month(2026, 3))

  assert.equal(bills[0].paid, true)
  assert.equal(bills[0].cleared, false)
  assert.equal(bills[1].paid, false)
  assert.equal(received.status, 'received')
})

test('bill data and payment history survive reloads without replacing saved bills or account data', () => {
  const values = new Map([
    ['money-honey-account-data', JSON.stringify({
      version: 1,
      accounts: [{ id: 7, name: 'Checking', archived: false }],
      transactions: []
    })]
  ])
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }

  let savedBills = loadBills([bill()], storage)
  const paidBill = {
    ...savedBills[0],
    paymentHistory: [{
      dueDate: savedBills[0].dueDate,
      paid: true,
      changedAt: '2026-04-01T10:00:00.000Z'
    }]
  }
  savedBills = [paidBill, bill({ id: 2, name: 'New bill', dueDate: '2026-05-10' })]
  saveBills(savedBills, storage)

  const reloaded = loadBills([bill({ id: 99, name: 'Replacement demo' })], storage)
  assert.deepEqual(reloaded, savedBills)
  assert.equal(getBillOccurrences(reloaded, month(2026, 3))[0].paid, true)
  assert.equal(getBillOccurrences(reloaded, month(2026, 3))[0].legacyPaid, true)
  assert.equal(createBillId(reloaded), 3)
  assert.equal(JSON.parse(values.get('money-honey-account-data')).accounts[0].name, 'Checking')
  assert.equal(JSON.parse(values.get(BILL_STORAGE_KEY)).version, 1)
})

test('payday period uses the configured frequency and next payday', () => {
  assert.deepEqual(
    getPaySchedulePeriod({ frequency: 'weekly', nextPayday: '2026-04-10' }, '2026-04-08'),
    { startDate: '2026-04-04', endDate: '2026-04-10' }
  )
  assert.deepEqual(
    getPaySchedulePeriod({ frequency: 'biweekly', nextPayday: '2026-04-03' }, '2026-04-08'),
    { startDate: '2026-04-04', endDate: '2026-04-17' }
  )
  assert.deepEqual(
    getPaySchedulePeriod({ frequency: 'monthly', nextPayday: '2026-01-31' }, '2026-02-15'),
    { startDate: '2026-02-01', endDate: '2026-02-28' }
  )
  assert.equal(getPaySchedulePeriod(null, '2026-04-08'), null)
})

test('payday summary counts each recurring occurrence once and enforces Total Due = Cleared + Remaining', () => {
  const bills = [
    bill({
      id: 1,
      name: 'Weekly subscription',
      amount: 12.35,
      dueDate: '2026-04-03',
      frequency: 'weekly',
      accountId: 1,
      paymentHistory: [{ dueDate: '2026-04-10', cleared: true, changedAt: '2026-04-10T12:00:00Z' }]
    }),
    bill({ id: 2, name: 'One-time cleared', amount: 20, dueDate: '2026-04-06', frequency: 'one-time', accountId: 1,
      paymentHistory: [{ dueDate: '2026-04-06', paid: true, changedAt: '2026-04-06T12:00:00Z' }] }),
    bill({ id: 3, name: 'Monthly expense', amount: 50, dueDate: '2026-01-15', frequency: 'monthly', accountId: 1 })
  ]
  const period = { startDate: '2026-04-04', endDate: '2026-04-17' }
  const transactions = [
    { id: 91, accountId: 1, name: bills[0].name, amount: -12.35, date: '2026-04-10', cleared: true, linkedOccurrenceType: 'bill', linkedOccurrenceId: 'bill:1:2026-04-10' },
    { id: 92, accountId: 1, name: bills[1].name, amount: -20, date: '2026-04-06', cleared: true, linkedOccurrenceType: 'bill', linkedOccurrenceId: 'bill:2:2026-04-06' }
  ]
  const occurrences = getBillOccurrencesInRange(bills, period.startDate, period.endDate, transactions)
  const summary = getPaydayBillSummary(bills, period, transactions)

  assert.deepEqual(occurrences.map(item => `${item.id}:${item.dueDate}`), [
    '2:2026-04-06',
    '1:2026-04-10',
    '3:2026-04-15',
    '1:2026-04-17'
  ])
  assert.deepEqual({
    totalDue: summary.totalDue,
    cleared: summary.cleared,
    remaining: summary.remaining,
    clearedCount: summary.clearedCount,
    totalCount: summary.totalCount
  }, {
    totalDue: 94.7,
    cleared: 32.35,
    remaining: 62.35,
    clearedCount: 2,
    totalCount: 4
  })
  assert.equal(summary.totalDue, 94.7)
})

test('payday summary separates paid, cleared, unpaid, and skipped occurrences', () => {
  const bills = [
    bill({
      id: 1,
      amount: 80,
      dueDate: '2026-04-10',
      accountId: 1,
      paymentHistory: [{ dueDate: '2026-04-10', paid: true }]
    }),
    bill({
      id: 2,
      amount: 10,
      dueDate: '2026-04-11',
      accountId: 1,
      debtId: 9,
      paymentHistory: [{ dueDate: '2026-04-11', skipped: true }]
    }),
    bill({ id: 3, amount: 25, dueDate: '2026-04-12', accountId: 1 })
  ]
  const transactions = [{
    id: 1,
    accountId: 1,
    name: bills[0].name,
    amount: -80,
    date: '2026-04-10',
    cleared: false,
    linkedOccurrenceType: 'bill',
    linkedOccurrenceId: 'bill:1:2026-04-10'
  }]
  const summary = getPaydayBillSummary(
    bills,
    { startDate: '2026-04-10', endDate: '2026-04-12' },
    transactions
  )

  assert.deepEqual({
    totalDue: summary.totalDue,
    paid: summary.paid,
    cleared: summary.cleared,
    remaining: summary.remaining,
    totalCount: summary.totalCount,
    skippedCount: summary.skippedCount
  }, {
    totalDue: 105,
    paid: 80,
    cleared: 0,
    remaining: 25,
    totalCount: 2,
    skippedCount: 1
  })
})

test('pay schedule persists and an unconfigured schedule remains unset', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
  assert.equal(loadPaySchedule(storage), null)

  const schedule = { frequency: 'biweekly', nextPayday: '2026-11-13' }
  savePaySchedule(schedule, storage)
  assert.deepEqual(loadPaySchedule(storage), schedule)
})

test('twice-monthly income clamps month-end dates and avoids duplicate occurrences', () => {
  const twiceMonthly = {
    id: 1,
    name: 'Child support',
    amount: 450,
    dueDate: '2026-01-15',
    frequency: 'twice-monthly',
    daysOfMonth: [30, 31],
    accountId: 1,
    active: true,
    archived: false,
    paymentHistory: []
  }
  const february = getIncomeOccurrences([twiceMonthly], month(2026, 1))
  assert.deepEqual(february.map(item => item.dueDate), ['2026-02-28'])

  const twoPaydays = {
    ...twiceMonthly,
    daysOfMonth: [1, 15],
    dueDate: '2026-01-01'
  }
  assert.deepEqual(
    getIncomeOccurrences([twoPaydays], month(2026, 3)).map(item => item.dueDate),
    ['2026-04-01', '2026-04-15']
  )
})

test('monthly commission schedule generates month-end dates and excludes dates before its first expected date', () => {
  const commission = {
    id: 4,
    name: 'Commission',
    amount: 1250,
    dueDate: '2026-01-31',
    frequency: 'monthly',
    accountId: 1,
    active: true,
    archived: false,
    paymentHistory: []
  }
  assert.deepEqual(
    getIncomeOccurrences([commission], month(2026, 1)).map(item => item.dueDate),
    ['2026-02-28']
  )
  assert.deepEqual(
    getIncomeOccurrences([commission], month(2026, 2)).map(item => item.dueDate),
    ['2026-03-31']
  )
})

test('income receipt changes the summary without implicitly creating an account transaction', () => {
  const income = {
    id: 8,
    name: 'Paycheck',
    amount: 1800,
    dueDate: '2026-04-10',
    frequency: 'biweekly',
    accountId: 1,
    active: true,
    archived: false,
    paymentHistory: []
  }
  const expected = getIncomeOccurrences([income], month(2026, 3))
  assert.equal(getIncomeSummary(expected).received, 0)
  const receivedIncome = updateIncomeStatus(income, '2026-04-10', 'received', '2026-04-10T12:00:00Z', 72)
  const receivedTransaction = {
    id: 72,
    accountId: 1,
    name: income.name,
    amount: 1800,
    date: '2026-04-10',
    cleared: false,
    linkedOccurrenceType: 'income',
    linkedOccurrenceId: 'income:8:2026-04-10'
  }
  const received = getIncomeOccurrences([receivedIncome], month(2026, 3), [receivedTransaction])
  assert.equal(getIncomeSummary(received).received, 1800)
  assert.equal(receivedIncome.paymentHistory[0].transactionId, 72)
  assert.deepEqual(
    getPaydayIncomeSummary([receivedIncome], { startDate: '2026-04-04', endDate: '2026-04-17' }, [receivedTransaction]),
    {
      totalExpected: 1800,
      received: 1800,
      stillExpected: 0,
      receivedCount: 1,
      totalCount: 1
    }
  )
})

test('income schedules and occurrence statuses persist alongside existing bills', () => {
  const values = new Map()
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
  const billData = loadBillData([bill()], storage)
  const income = updateIncomeStatus({
    id: 1,
    name: 'Reimbursement',
    amount: 200,
    dueDate: '2026-04-12',
    frequency: 'one-time',
    active: true,
    archived: false,
    paymentHistory: []
  }, '2026-04-12', 'received', '2026-04-12T12:00:00Z')
  saveIncomeSchedules([income], storage)
  assert.deepEqual(loadIncomeSchedules(storage), [income])
  assert.deepEqual(loadBillData([], storage).bills, billData.bills)
})

test('creating a received occurrence transaction is idempotent and existing links cannot be reused', () => {
  const values = new Map([
    ['money-honey-account-data', JSON.stringify({
      version: 1,
      accounts: [{ id: 2, name: 'Checking', archived: false }],
      transactions: [{ id: 7, sequence: 4, accountId: 2, name: 'Existing paycheck', amount: 900, date: '2026-04-10', cleared: true }]
    })]
  ])
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
  const income = {
    id: 3,
    name: 'Paycheck',
    amount: 900,
    dueDate: '2026-04-10',
    frequency: 'biweekly',
    accountId: 2,
    active: true,
    archived: false,
    paymentHistory: []
  }
  const linked = linkIncomeToTransaction(income, '2026-04-10', 7, [income], storage)
  assert.equal(linked.paymentHistory.at(-1).transactionId, 7)
  assert.throws(
    () => linkIncomeToTransaction(
      { ...income, id: 4 },
      '2026-04-10',
      7,
      [linked, { ...income, id: 4 }],
      storage
    ),
    /already linked/
  )

  saveIncomeSchedules([], storage)
  const receivedIncome = updateIncomeStatus(income, '2026-04-10', 'received', '2026-04-10T12:00:00Z')
  const created = createIncomeTransaction(receivedIncome, '2026-04-10', storage)
  saveIncomeSchedules([created], storage)
  const retry = createIncomeTransaction(created, '2026-04-10', storage)
  assert.equal(retry.paymentHistory.at(-1).transactionId, created.paymentHistory.at(-1).transactionId)
  const accountData = JSON.parse(values.get('money-honey-account-data'))
  assert.equal(accountData.transactions.length, 2)
  assert.equal(accountData.transactions[1].amount, 900)
  assert.equal(accountData.transactions[1].cleared, false)
})

test('Money In and Money Out view data filters list, calendar dots, and inline selected-day details independently', () => {
  const billOccurrences = [
    { id: 1, dueDate: '2026-04-10', amount: 25, cleared: false },
    { id: 2, dueDate: '2026-04-15', amount: 40, cleared: true }
  ]
  const incomeOccurrences = [
    { id: 3, dueDate: '2026-04-10', amount: 300, status: 'expected' }
  ]
  const outView = getScheduleViewData('out', billOccurrences, incomeOccurrences, '2026-04-10')
  const inView = getScheduleViewData('in', billOccurrences, incomeOccurrences, '2026-04-10')
  const outCalendarView = getScheduleViewData('out', billOccurrences, incomeOccurrences, '2026-04-15', 'calendar')
  const emptyIncomeView = getScheduleViewData('in', billOccurrences, [], '2026-04-10')
  const emptyOutView = getScheduleViewData('out', [], incomeOccurrences, '2026-04-10')

  assert.deepEqual(outView.occurrences, billOccurrences)
  assert.equal(outView.view, 'list')
  assert.equal(outCalendarView.view, 'calendar')
  assert.deepEqual(outCalendarView.occurrences, outView.occurrences)
  assert.deepEqual(outCalendarView.selectedDayOccurrences, [billOccurrences[1]])
  assert.deepEqual(outCalendarView.calendarDates, outView.calendarDates)
  assert.deepEqual(outView.selectedDayOccurrences, [billOccurrences[0]])
  assert.deepEqual([...outView.calendarDates], ['2026-04-10', '2026-04-15'])
  assert.deepEqual(inView.occurrences, incomeOccurrences)
  assert.deepEqual(inView.selectedDayOccurrences, [incomeOccurrences[0]])
  assert.deepEqual([...inView.calendarDates], ['2026-04-10'])
  assert.deepEqual(emptyIncomeView.occurrences, [])
  assert.deepEqual([...emptyIncomeView.calendarDates], [])
  assert.deepEqual(emptyOutView.occurrences, [])
  assert.deepEqual([...emptyOutView.calendarDates], [])
  assert.deepEqual(emptyIncomeView.selectedDayOccurrences, [])
  assert.deepEqual(emptyOutView.selectedDayOccurrences, [])
  assert.deepEqual(getScheduleSummary('out', billOccurrences, incomeOccurrences, '2026-04-10'), {
    firstLabel: 'TOTAL DUE',
    firstValue: 65,
    secondLabel: 'CLEARED',
    secondValue: 40,
    thirdLabel: 'REMAINING',
    thirdValue: 25
  })

  test('individual bill and income occurrence edits persist without changing the recurring schedule or history', () => {
    const schedule = {
      id: 21,
      name: 'Monthly payment',
      amount: 80,
      dueDate: '2026-01-10',
      frequency: 'monthly',
      accountId: 1,
      paymentHistory: [{ dueDate: '2026-04-10', cleared: true, status: 'received' }]
    }
    const edited = updateScheduleOccurrence(schedule, '2026-04-10', {
      name: 'Adjusted payment',
      amount: 95,
      dueDate: '2026-04-12'
    })
    const outOccurrence = getBillOccurrences([edited], month(2026, 3))

    assert.deepEqual(outOccurrence.map(item => [item.name, item.amount, item.dueDate, item.scheduledDate, item.cleared]), [
      ['Adjusted payment', 95, '2026-04-12', '2026-04-10', false]
    ])
    assert.deepEqual(getBillOccurrences([edited], month(2026, 4)).map(item => item.dueDate), ['2026-05-10'])
    assert.equal(edited.dueDate, schedule.dueDate)
    assert.equal(edited.paymentHistory.length, 1)

    const editedIncome = updateScheduleOccurrence({
      ...schedule,
      paymentHistory: [{ dueDate: '2026-04-10', status: 'received' }]
    }, '2026-04-10', { amount: 120, dueDate: '2026-04-12' })
    const incomeOccurrence = getIncomeOccurrences([editedIncome], month(2026, 3))
    assert.deepEqual(incomeOccurrence.map(item => [item.amount, item.dueDate, item.status]), [
      [120, '2026-04-12', 'received']
    ])

    const values = new Map()
    const storage = {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, value)
    }
    saveBills([edited], storage)
    assert.deepEqual(getBillOccurrences(loadBills([], storage), month(2026, 3)), outOccurrence)
  })

  test('paused and archived bill schedules remain saved but do not generate occurrences', () => {
    const active = bill({ dueDate: '2026-04-10' })
    const paused = { ...active, id: 2, active: false }
    const archived = { ...active, id: 3, archived: true, active: false }

    assert.deepEqual(getBillOccurrences([active, paused, archived], month(2026, 3)).map(item => item.id), [1])
    assert.deepEqual(getBillOccurrences([paused, archived], month(2026, 3)), [])
    assert.equal(paused.paymentHistory.length, 0)
    assert.equal(archived.paymentHistory.length, 0)
  })

  test('recurring occurrences respect their start date and optional end date', () => {
    const bounded = bill({
      dueDate: '2026-04-10',
      endDate: '2026-05-15',
      frequency: 'monthly'
    })

    assert.deepEqual(
      getBillOccurrencesInRange([bounded], '2026-03-01', '2026-06-30')
        .map(item => item.dueDate),
      ['2026-04-10', '2026-05-10']
    )
  })
  assert.deepEqual(getScheduleSummary('in', billOccurrences, incomeOccurrences, '2026-04-10'), {
    firstLabel: 'TOTAL INCOMING',
    firstValue: 300,
    secondLabel: 'RECEIVED',
    secondValue: 0,
    thirdLabel: 'REMAINING',
    thirdValue: 300
  })
})

test('bill and income schedule lists support the same twice-monthly recurrence dates', () => {
  const schedule = {
    id: 8,
    name: 'Twice monthly entry',
    amount: 25,
    dueDate: '2026-01-15',
    frequency: 'twice-monthly',
    daysOfMonth: [15, 31],
    paymentHistory: []
  }

  assert.deepEqual(
    getBillOccurrences([schedule], month(2026, 0)).map(item => item.dueDate),
    ['2026-01-15', '2026-01-31']
  )
  assert.deepEqual(
    getIncomeOccurrences([schedule], month(2026, 0)).map(item => item.dueDate),
    ['2026-01-15', '2026-01-31']
  )
})
