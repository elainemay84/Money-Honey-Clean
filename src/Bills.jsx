import { useEffect, useRef, useState } from 'react'
import {
  createIncomeId,
  createBillId,
  createDemoBills,
  formatLocalDate,
  getBillOccurrencesInRange,
  getIncomeOccurrences,
  getIncomeOccurrencesInRange,
  getScheduleViewData,
  getBillOccurrences,
  loadBillData,
  saveBillData,
  updateIncomeStatus,
  updateBillOccurrenceSkip,
  updateScheduleOccurrence
} from './billData.js'
import {
  createOccurrenceTransaction,
  linkExistingOccurrenceTransaction,
  loadSavedAccountData,
  removeOccurrenceTransaction,
  updateOccurrenceTransaction,
  updateOccurrenceTransactions
} from './accountStorage.js'
import {
  DEBT_PAYMENT_CALCULATION_METHODS,
  getDebtPaymentCalculationMethod,
  loadDebts,
  recordDebtPaymentFromTransaction,
  reconcileDebtPaymentForTransaction,
  removeDebtPaymentForTransaction,
  saveDebts
} from './debtData.js'

const today = formatLocalDate(new Date())
const frequencies = ['one-time', 'weekly', 'biweekly', 'twice-monthly', 'monthly', 'quarterly', 'yearly']
const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function monthStart(date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1))
}

function addMonths(date, amount) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1))
}

function monthLabel(date) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function firstDateOfMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function lastDateOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)
}

function getEarliestScheduleDate(schedules) {
  const dates = schedules
    .filter(schedule => !schedule.archived && schedule.active !== false)
    .flatMap(schedule => [
      schedule.dueDate,
      ...(schedule.occurrenceOverrides ?? []).flatMap(override => [
        override.scheduledDate,
        override.dueDate
      ]),
      ...(schedule.paymentHistory ?? []).map(entry => entry.dueDate)
    ])
    .filter(date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return false
      const parsed = new Date(`${date}T00:00:00Z`)
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    })

  return dates.sort()[0] ?? null
}

function formatDueDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
}

function isOccurrenceCompleted(flow, occurrence) {
  return flow === 'out'
    ? occurrence.paid === true || occurrence.skipped === true
    : occurrence.status === 'received'
}

const card = {
  background: '#FFFFFF',
  padding: 18,
  borderRadius: 20,
  marginBottom: 16,
  boxShadow: '0 3px 14px #76552212'
}

const field = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  padding: 10,
  borderRadius: 10,
  border: '1px solid #E9D6B7',
  background: '#FFFFFF'
}

const smallAction = {
  border: '1px solid #E9D6B7',
  borderRadius: 9,
  padding: '6px 7px',
  background: '#FFF8ED',
  color: '#79502A',
  fontSize: 10,
  cursor: 'pointer'
}

export default function Bills() {
  const [initialData] = useState(() => loadBillData(createDemoBills()))
  const [bills, setBills] = useState(initialData.bills)
  const [incomes, setIncomes] = useState(initialData.incomes)
  const [accountData, setAccountData] = useState(() => loadSavedAccountData())
  const [debts, setDebts] = useState(() => loadDebts())
  const accountOptions = accountData?.accounts.filter(account => !account.archived) ?? []
  const accountTransactions = accountData?.transactions ?? []
  const [flow, setFlow] = useState('out')
  const [currentMonth] = useState(() => monthStart(new Date()))
  const [selectedMonth, setSelectedMonth] = useState(() => monthStart(new Date()))
  const [view, setView] = useState('list')
  const [showCompleted, setShowCompleted] = useState(false)
  const [selectedDay, setSelectedDay] = useState(today)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingBillId, setEditingBillId] = useState(null)
  const [editingScope, setEditingScope] = useState('schedule')
  const [editingOccurrenceDate, setEditingOccurrenceDate] = useState(null)
  const [editingLinkedTransactionId, setEditingLinkedTransactionId] = useState(null)
  const [editingOccurrence, setEditingOccurrence] = useState(null)
  const [selectedOccurrence, setSelectedOccurrence] = useState(null)
  const [actualDate, setActualDate] = useState(today)
  const [paymentAccountId, setPaymentAccountId] = useState('')
  const [linkedDebtId, setLinkedDebtId] = useState('')
  const [occurrenceError, setOccurrenceError] = useState('')
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(today)
  const [frequency, setFrequency] = useState('one-time')
  const [autopay, setAutopay] = useState(false)
  const [accountId, setAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [daysOfMonth, setDaysOfMonth] = useState(['1', '15'])
  const [formError, setFormError] = useState('')
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false)
  const [linkingOccurrence, setLinkingOccurrence] = useState(null)
  const [selectedTransactionId, setSelectedTransactionId] = useState('')
  const [linkError, setLinkError] = useState('')
  const [transactionOptions, setTransactionOptions] = useState([])

  const billOccurrences = getBillOccurrences(bills, selectedMonth, accountTransactions)
  const incomeOccurrences = getIncomeOccurrences(incomes, selectedMonth, accountTransactions)
  const listSchedules = flow === 'out' ? bills : incomes
  const earliestScheduleDate = getEarliestScheduleDate(listSchedules)
  const earliestScheduleMonth = earliestScheduleDate
    ? monthStart(new Date(`${earliestScheduleDate}T00:00:00Z`))
    : currentMonth
  const listStartMonth = earliestScheduleMonth < currentMonth ? earliestScheduleMonth : currentMonth
  const listStartDate = firstDateOfMonth(listStartMonth)
  const listEndMonth = addMonths(currentMonth, 11)
  const listEndDate = lastDateOfMonth(listEndMonth)
  const listBillOccurrences = getBillOccurrencesInRange(
    bills,
    listStartDate,
    listEndDate,
    accountTransactions
  )
  const listIncomeOccurrences = getIncomeOccurrencesInRange(
    incomes,
    listStartDate,
    listEndDate,
    accountTransactions
  )
  const listOccurrences = flow === 'out' ? listBillOccurrences : listIncomeOccurrences
  const listMonthCount = (
    (listEndMonth.getUTCFullYear() - listStartMonth.getUTCFullYear()) * 12
    + listEndMonth.getUTCMonth() - listStartMonth.getUTCMonth() + 1
  )
  const listMonths = Array.from({ length: listMonthCount }, (_, index) => addMonths(listStartMonth, index))
    .map(month => {
      const monthKey = firstDateOfMonth(month).slice(0, 7)
      const occurrences = listOccurrences.filter(item => item.dueDate.startsWith(monthKey))
      const total = occurrences.reduce(
        (sum, item) => sum + Math.round(item.amount * 100),
        0
      ) / 100
      const visibleOccurrences = showCompleted
        ? occurrences
        : occurrences.filter(item => !isOccurrenceCompleted(flow, item))
      return { month, monthKey, occurrences, visibleOccurrences, total }
    })
    .filter(group => group.occurrences.length > 0)
    .filter(group =>
      showCompleted
      || group.month >= currentMonth
      || group.visibleOccurrences.length > 0
    )
  const initialScrollMonthKey = listMonths.find(group => group.month >= currentMonth)?.monthKey
    ?? listMonths.at(-1)?.monthKey
  const scheduleView = getScheduleViewData(flow, billOccurrences, incomeOccurrences, selectedDay, view)
  const { occurrences: calendarOccurrences, selectedDayOccurrences, calendarDates } = scheduleView
  const inactiveSchedules = (flow === 'in' ? incomes : bills)
    .filter(schedule => schedule.archived || schedule.active === false)
  const calendarTotal = calendarOccurrences.reduce(
    (total, occurrence) => total + Math.round(occurrence.amount * 100),
    0
  ) / 100
  const editingSchedule = (flow === 'out' ? bills : incomes)
    .find(schedule => schedule.id === editingBillId)
  const selectedOccurrenceDebt = selectedOccurrence?.debtId == null
    ? null
    : debts.find(debt => debt.id === selectedOccurrence.debtId) ?? null
  const paymentAccountIsAvailable = accountOptions.some(account =>
    account.id === selectedOccurrence?.accountId
  )
  const monthDays = new Date(Date.UTC(
    selectedMonth.getUTCFullYear(),
    selectedMonth.getUTCMonth() + 1,
    0
  )).getUTCDate()
  const firstWeekday = selectedMonth.getUTCDay()
  const currentMonthRef = useRef(null)

  useEffect(() => {
    currentMonthRef.current?.scrollIntoView?.({ block: 'start' })
  }, [])

  function persistData(nextBills = bills, nextIncomes = incomes) {
    setBills(nextBills)
    setIncomes(nextIncomes)
    saveBillData({ bills: nextBills, incomes: nextIncomes })
    window.dispatchEvent(new Event('money-honey-bills-updated'))
  }

  useEffect(() => {
    const refreshAccountData = () => setAccountData(loadSavedAccountData())
    window.addEventListener('money-honey-accounts-updated', refreshAccountData)
    window.addEventListener('storage', refreshAccountData)
    return () => {
      window.removeEventListener('money-honey-accounts-updated', refreshAccountData)
      window.removeEventListener('storage', refreshAccountData)
    }
  }, [])

  useEffect(() => {
    const refreshBillData = () => {
      const saved = loadBillData([])
      setBills(saved.bills)
      setIncomes(saved.incomes)
      setDebts(loadDebts())
    }
    window.addEventListener('money-honey-bills-updated', refreshBillData)
    window.addEventListener('storage', refreshBillData)
    return () => {
      window.removeEventListener('money-honey-bills-updated', refreshBillData)
      window.removeEventListener('storage', refreshBillData)
    }
  }, [])

  useEffect(() => {
    const refreshDebts = () => setDebts(loadDebts())
    window.addEventListener('money-honey-debts-updated', refreshDebts)
    window.addEventListener('storage', refreshDebts)
    return () => {
      window.removeEventListener('money-honey-debts-updated', refreshDebts)
      window.removeEventListener('storage', refreshDebts)
    }
  }, [])

  function updateBills(nextBills) {
    persistData(nextBills, incomes)
  }

  function updateIncomes(nextIncomes) {
    persistData(bills, nextIncomes)
  }

  function persistDebtBillLink(billId, debtId) {
    const linkedElsewhere = debts.find(debt =>
      debt.id === debtId && debt.billId != null && debt.billId !== billId
    )
    if (linkedElsewhere) {
      throw new Error('This debt is already linked to another bill schedule.')
    }
    const nextDebts = debts.map(debt => {
      if (debt.id === debtId) return { ...debt, billId }
      if (debt.billId === billId) return { ...debt, billId: null }
      return debt
    })
    setDebts(nextDebts)
    saveDebts(nextDebts)
  }

  function openNewBill() {
    setEditingBillId(null)
    setEditingScope('schedule')
    setEditingOccurrenceDate(null)
    setEditingLinkedTransactionId(null)
    setEditingOccurrence(null)
    setName('')
    setAmount('')
    setDueDate(today)
    setFrequency(flow === 'in' ? 'monthly' : 'one-time')
    setAutopay(false)
    setAccountId('')
    setNotes('')
    setDaysOfMonth(['1', '15'])
    setLinkedDebtId('')
    setFormError('')
    setIsFormOpen(true)
  }

  function openEditBill(bill) {
    const savedBill = flow === 'out'
      ? bills.find(item => item.id === bill.id) ?? bill
      : incomes.find(item => item.id === bill.id) ?? bill
    setEditingBillId(savedBill.id)
    setEditingScope('schedule')
    setEditingOccurrenceDate(null)
    setEditingLinkedTransactionId(null)
    setEditingOccurrence(null)
    setName(savedBill.name)
    setAmount(String(savedBill.amount))
    setDueDate(savedBill.dueDate)
    setFrequency(savedBill.frequency)
    setAutopay(savedBill.autopay)
    setAccountId(savedBill.accountId == null ? '' : String(savedBill.accountId))
    setNotes(savedBill.notes ?? '')
    setDaysOfMonth((savedBill.daysOfMonth ?? [1, 15]).map(String))
    setLinkedDebtId(savedBill.debtId == null ? '' : String(savedBill.debtId))
    setFormError('')
    setIsFormOpen(true)
  }

  function openEditOccurrence(occurrence) {
    const savedSchedule = flow === 'out'
      ? bills.find(item => item.id === occurrence.id) ?? occurrence
      : incomes.find(item => item.id === occurrence.id) ?? occurrence
    setEditingBillId(savedSchedule.id)
    setEditingScope('occurrence')
    setEditingOccurrence(occurrence)
    setEditingOccurrenceDate(occurrence.scheduledDate ?? occurrence.dueDate)
    setEditingLinkedTransactionId(occurrence.transactionId ?? null)
    setName(occurrence.name)
    setAmount(String(occurrence.amount))
    setDueDate(occurrence.dueDate)
    setFrequency(savedSchedule.frequency)
    setAutopay(Boolean(occurrence.autopay))
    setAccountId(occurrence.accountId == null ? '' : String(occurrence.accountId))
    setNotes(occurrence.notes ?? '')
    setDaysOfMonth((savedSchedule.daysOfMonth ?? [1, 15]).map(String))
    setFormError('')
    setIsFormOpen(true)
  }

  function selectEditingScope(scope) {
    if (scope === 'schedule' && editingSchedule) {
      setEditingScope('schedule')
      setEditingOccurrenceDate(null)
      setEditingLinkedTransactionId(null)
      setName(editingSchedule.name)
      setAmount(String(editingSchedule.amount))
      setDueDate(editingSchedule.dueDate)
      setFrequency(editingSchedule.frequency)
      setAutopay(Boolean(editingSchedule.autopay))
      setAccountId(editingSchedule.accountId == null ? '' : String(editingSchedule.accountId))
      setNotes(editingSchedule.notes ?? '')
      setDaysOfMonth((editingSchedule.daysOfMonth ?? [1, 15]).map(String))
      setLinkedDebtId(editingSchedule.debtId == null ? '' : String(editingSchedule.debtId))
    } else if (scope === 'occurrence' && editingOccurrence) {
      setEditingScope('occurrence')
      setEditingOccurrenceDate(editingOccurrence.scheduledDate ?? editingOccurrence.dueDate)
      setEditingLinkedTransactionId(editingOccurrence.transactionId ?? null)
      setName(editingOccurrence.name)
      setAmount(String(editingOccurrence.amount))
      setDueDate(editingOccurrence.dueDate)
      setFrequency(editingSchedule?.frequency ?? 'one-time')
      setAutopay(Boolean(editingOccurrence.autopay))
      setAccountId(editingOccurrence.accountId == null ? '' : String(editingOccurrence.accountId))
      setNotes(editingOccurrence.notes ?? '')
      setDaysOfMonth((editingSchedule?.daysOfMonth ?? [1, 15]).map(String))
    }
  }

  function openPaymentConfirmation(occurrence) {
    setSelectedOccurrence(occurrence)
    setActualDate(today)
    setPaymentAccountId(occurrence.accountId == null ? '' : String(occurrence.accountId))
    setOccurrenceError('')
  }

  function openOccurrenceForEdit(occurrence) {
    if (occurrence.status === 'paused' || occurrence.status === 'archived') {
      openEditBill(occurrence)
    } else {
      openEditOccurrence(occurrence)
    }
  }

  function confirmOccurrencePayment() {
    if (!selectedOccurrence) return
    const occurrence = flow === 'out' && !paymentAccountIsAvailable
      ? { ...selectedOccurrence, accountId: Number(paymentAccountId) }
      : selectedOccurrence

    try {
      if (flow === 'out' && !accountOptions.some(account => account.id === occurrence.accountId)) {
        throw new Error('Choose an active account for this payment.')
      }
      const result = createOccurrenceTransaction(flow, occurrence, actualDate)
      if (result.status === 'matches') {
        setTransactionOptions(result.transactions)
        setLinkingOccurrence(occurrence)
        setSelectedTransactionId('')
        setLinkError('')
        setSelectedOccurrence(null)
        setIsLinkDialogOpen(true)
        return
      }
      recordOccurrencePayment(occurrence, result.transaction.id)
      setAccountData(loadSavedAccountData())
      setSelectedOccurrence(null)
    } catch (error) {
      setOccurrenceError(error.message)
    }
  }

  function recordOccurrencePayment(occurrence, transactionId) {
    const scheduledDate = occurrence.scheduledDate ?? occurrence.dueDate
    if (flow === 'out') {
      const bill = bills.find(item => item.id === occurrence.id)
      if (bill?.debtId != null) {
        recordDebtPaymentFromTransaction(bill.debtId, transactionId, {
          date: actualDate,
          principal: null,
          interest: 0,
          fees: 0,
          automaticPrincipal: true,
          scheduledDueDate: scheduledDate,
          billOccurrenceId: occurrence.occurrenceId
        })
      }
      updateBills(bills.map(bill => bill.id === occurrence.id
        ? (() => {
          const history = bill.paymentHistory ?? []
          if (history.some(entry => entry.transactionId === transactionId)) return bill
          return {
            ...bill,
            accountId: bill.accountId ?? occurrence.accountId,
            paymentHistory: [...history, {
            dueDate: scheduledDate,
            actualDate,
            transactionId,
            paid: true,
            changedAt: new Date().toISOString()
            }]
          }
        })()
        : bill
      ))
    } else {
      const income = incomes.find(item => item.id === occurrence.id)
      if (income?.paymentHistory?.some(entry => entry.transactionId === transactionId)) return
      const updated = updateIncomeStatus(income, scheduledDate, 'received', new Date().toISOString(), transactionId)
      updateIncomes(incomes.map(item => item.id === occurrence.id ? updated : item))
    }
  }

  function undoOccurrencePayment(occurrence) {
    const recordedLabel = flow === 'out' ? 'payment' : 'receipt'
    if (!window.confirm(`Undo this ${recordedLabel} for ${occurrence.name}? Its linked account transaction will be removed.`)) {
      return
    }

    try {
      const transaction = removeOccurrenceTransaction(flow, occurrence)
      if (flow === 'out') removeDebtPaymentForTransaction(transaction.id)
      if (flow === 'out') {
        updateBills(bills.map(bill => bill.id === occurrence.id
          ? {
            ...bill,
            paymentHistory: (bill.paymentHistory ?? [])
              .filter(entry => entry.transactionId !== transaction.id)
          }
          : bill
        ))
      } else {
        updateIncomes(incomes.map(income => income.id === occurrence.id
          ? {
            ...income,
            paymentHistory: (income.paymentHistory ?? [])
              .filter(entry => entry.transactionId !== transaction.id)
          }
          : income
        ))
      }
      setAccountData(loadSavedAccountData())
    } catch (error) {
      window.alert(error.message)
    }
  }

  function handleOccurrenceAction(occurrence) {
    const isRecorded = flow === 'in'
      ? occurrence.status === 'received'
      : occurrence.paid
    if (isRecorded) undoOccurrencePayment(occurrence)
    else openPaymentConfirmation(occurrence)
  }

  function handleSkipOccurrence(occurrence) {
    const bill = bills.find(item => item.id === occurrence.id)
    if (!bill || bill.debtId == null || occurrence.paid) return
    const dueDate = occurrence.scheduledDate ?? occurrence.dueDate
    if (occurrence.skipped) {
      updateBills(bills.map(item => item.id === bill.id
        ? updateBillOccurrenceSkip(item, dueDate, false)
        : item
      ))
      return
    }

    if (!window.confirm(
      `Skip ${occurrence.name} scheduled for ${formatDueDate(occurrence.dueDate)} (${money(occurrence.amount)})? This is only an internal planning status. It does not change your lender's terms, interest, fees, or payment obligation.`
    )) return

    updateBills(bills.map(item => item.id === bill.id
      ? updateBillOccurrenceSkip(item, dueDate, true)
      : item
    ))
  }

  function updateScheduleManagement(changes) {
    if (editingBillId === null) return
    if (flow === 'out') {
      updateBills(bills.map(bill => bill.id === editingBillId ? { ...bill, ...changes } : bill))
    } else {
      updateIncomeSchedule(editingBillId, changes)
    }
  }

  function saveBill(event) {
    event.preventDefault()
    setFormError('')
    const numericAmount = Number(amount)
    if (!name.trim() || !dueDate || !Number.isFinite(numericAmount) || numericAmount <= 0) return
    if (flow === 'out' && editingScope === 'schedule' && linkedDebtId !== '' && frequency === 'one-time') {
      setFormError('Only recurring bills can be linked to a debt.')
      return
    }
    const selectedDays = frequency === 'twice-monthly'
      ? [...new Set(daysOfMonth.map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 31))].sort((a, b) => a - b)
      : []
    if (editingScope === 'schedule' && frequency === 'twice-monthly' && selectedDays.length !== 2) {
      setFormError('Choose two different days of the month.')
      return
    }
    if (editingScope === 'schedule' && frequency === 'twice-monthly' && !selectedDays.includes(Number(dueDate.slice(-2)))) {
      setFormError('The first scheduled date must match one of the selected monthly days.')
      return
    }

    if (editingScope === 'occurrence' && editingBillId !== null && editingOccurrenceDate) {
      if (editingLinkedTransactionId !== null) {
        const linkedChanges = {}
        if (name.trim() !== editingOccurrence.name) linkedChanges.name = name.trim()
        if (numericAmount !== editingOccurrence.amount) {
          linkedChanges.amount = flow === 'out' ? -numericAmount : numericAmount
        }
        if (accountId !== String(editingOccurrence.accountId ?? '')) {
          linkedChanges.accountId = accountId === '' ? null : Number(accountId)
        }
        if (dueDate !== editingOccurrence.dueDate) linkedChanges.date = dueDate

        if (Object.keys(linkedChanges).length && accountId === '') {
          setFormError('Choose an associated account to keep the linked transaction valid.')
          return
        }
        if (Object.keys(linkedChanges).length) {
          if (!window.confirm(
            'This occurrence is linked to an account transaction. Update the changed transaction fields to match?'
          )) {
            setFormError('The linked transaction was not changed; cancel or confirm the matching transaction update.')
            return
          }
          try {
            updateOccurrenceTransaction(editingLinkedTransactionId, linkedChanges)
            reconcileDebtPaymentForTransaction(editingLinkedTransactionId)
            setAccountData(loadSavedAccountData())
          } catch (error) {
            setFormError(error.message)
            return
          }
        }
      }
      const occurrenceChanges = {
        name: name.trim(),
        amount: numericAmount,
        dueDate,
        accountId: accountId === '' ? null : Number(accountId),
        notes: notes.trim()
      }
      if (flow === 'out') occurrenceChanges.autopay = autopay
      const updatedSchedules = (flow === 'out' ? bills : incomes).map(schedule =>
        schedule.id === editingBillId
          ? updateScheduleOccurrence(schedule, editingOccurrenceDate, occurrenceChanges)
          : schedule
      )
      if (flow === 'out') updateBills(updatedSchedules)
      else updateIncomes(updatedSchedules)
      const occurrenceDate = new Date(`${dueDate}T00:00:00Z`)
      if (Number.isFinite(occurrenceDate.getTime())) {
        setSelectedMonth(monthStart(occurrenceDate))
        setSelectedDay(dueDate)
      }
      setIsFormOpen(false)
      return
    }

    if (editingScope === 'schedule' && editingBillId !== null) {
      const currentSchedule = (flow === 'out' ? bills : incomes)
        .find(item => item.id === editingBillId)
      const linkedTransactions = accountTransactions.filter(transaction =>
        transaction.linkedOccurrenceId?.startsWith(`${flow === 'out' ? 'bill' : 'income'}:${editingBillId}:`)
        || (flow === 'in' && transaction.linkedIncomeOccurrenceId?.startsWith(`${editingBillId}:`))
      )
      const linkedFieldsChanged = linkedTransactions.length > 0 && (
        linkedTransactions.some(transaction =>
          transaction.name !== name.trim()
          || transaction.amount !== (flow === 'out' ? -numericAmount : numericAmount)
          || transaction.accountId !== (accountId === '' ? null : Number(accountId))
        )
        || currentSchedule?.dueDate !== dueDate
        || currentSchedule?.frequency !== frequency
        || JSON.stringify(currentSchedule?.daysOfMonth ?? []) !== JSON.stringify(selectedDays)
      )
      if (linkedFieldsChanged) {
        if (accountId === '') {
          setFormError('Choose an associated account to keep linked transactions valid.')
          return
        }
        if (!window.confirm(
          `This schedule has ${linkedTransactions.length} linked transaction(s). Confirm the schedule change and update transaction descriptions, amounts, and accounts to match. Actual transaction dates and clearing statuses will be preserved.`
        )) {
          setFormError('The schedule was not changed because its linked transactions were not updated.')
          return
        }
        try {
          const signedAmount = flow === 'out' ? -numericAmount : numericAmount
          updateOccurrenceTransactions(linkedTransactions.map(transaction => transaction.id), {
            name: name.trim(),
            amount: signedAmount,
            accountId: Number(accountId)
          })
          for (const transaction of linkedTransactions) {
            reconcileDebtPaymentForTransaction(transaction.id)
          }
          setAccountData(loadSavedAccountData())
        } catch (error) {
          setFormError(error.message)
          return
        }
      }
    }

    if (flow === 'out' && editingBillId !== null) {
      try {
        persistDebtBillLink(editingBillId, linkedDebtId === '' ? null : Number(linkedDebtId))
      } catch (error) {
        setFormError(error.message)
        return
      }
      updateBills(bills.map(bill => bill.id === editingBillId
        ? {
          ...bill,
          name: name.trim(),
          amount: numericAmount,
          dueDate,
          frequency,
          autopay,
          debtId: linkedDebtId === '' ? null : Number(linkedDebtId),
          accountId: accountId === '' ? null : Number(accountId),
          notes: notes.trim(),
          daysOfMonth: frequency === 'twice-monthly' ? selectedDays : []
        }
        : bill
      ))
    } else if (flow === 'out') {
      const newBillId = createBillId(bills)
      try {
        if (linkedDebtId !== '') persistDebtBillLink(newBillId, Number(linkedDebtId))
      } catch (error) {
        setFormError(error.message)
        return
      }
      updateBills([...bills, {
        id: newBillId,
        name: name.trim(),
        amount: numericAmount,
        dueDate,
        frequency,
        autopay,
        accountId: accountId === '' ? null : Number(accountId),
        debtId: linkedDebtId === '' ? null : Number(linkedDebtId),
        notes: notes.trim(),
        daysOfMonth: frequency === 'twice-monthly'
          ? [...new Set(daysOfMonth.map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 31))].sort((a, b) => a - b)
          : [],
        paymentHistory: []
      }])
    } else {
      const incomeChanges = {
        name: name.trim(),
        amount: numericAmount,
        dueDate,
        frequency,
        accountId: accountId === '' ? null : Number(accountId),
        notes: notes.trim(),
        daysOfMonth: selectedDays
      }
      if (editingBillId !== null) {
        updateIncomes(incomes.map(income => income.id === editingBillId
          ? { ...income, ...incomeChanges }
          : income
        ))
      } else {
        updateIncomes([...incomes, {
          id: createIncomeId(incomes),
          ...incomeChanges,
          active: true,
          archived: false,
          paymentHistory: []
        }])
      }
    }

    setIsFormOpen(false)
  }

  function linkExistingTransaction(event) {
    event.preventDefault()
    try {
      const linked = linkExistingOccurrenceTransaction(
        flow,
        linkingOccurrence,
        Number(selectedTransactionId)
      )
      recordOccurrencePayment(linkingOccurrence, linked.id)
      setAccountData(loadSavedAccountData())
      setIsLinkDialogOpen(false)
    } catch (error) {
      setLinkError(error.message)
    }
  }

  function updateIncomeSchedule(id, changes) {
    updateIncomes(incomes.map(income => income.id === id ? { ...income, ...changes } : income))
  }

  const calendarCells = [
    ...Array.from({ length: firstWeekday }, (_, index) => ({ key: `blank-${index}` })),
    ...Array.from({ length: monthDays }, (_, index) => {
      const day = index + 1
      const date = `${selectedMonth.getUTCFullYear()}-${String(selectedMonth.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return {
        key: date,
        day,
        date,
        hasItems: calendarDates.has(date)
      }
    })
  ]

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 210 }}>
      <header style={{
        marginBottom: 16
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h1 style={{
            margin: 0,
            color: '#B87522',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic'
          }}>
            Bills 🍯
          </h1>
          <div style={{ display: 'flex', gap: 3, padding: 3, borderRadius: 10, background: '#F5D6A5' }}>
            {['out', 'in'].map(direction => (
              <button
                key={direction}
                type="button"
                aria-pressed={flow === direction}
                onClick={() => {
                  setFlow(direction)
                }}
                style={{
                  border: 'none',
                  borderRadius: 8,
                  padding: '7px 10px',
                  background: flow === direction ? '#FFFFFF' : 'transparent',
                  color: '#79502A',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Money {direction === 'out' ? 'Out' : 'In'}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3, padding: 3, width: 'fit-content', marginLeft: 'auto', borderRadius: 10, background: '#F5D6A5' }}>
          {['list', 'calendar'].map(mode => (
            <button
              key={mode}
              type="button"
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
              style={{
                border: 'none',
                borderRadius: 8,
                padding: '7px 9px',
                background: view === mode ? '#FFFFFF' : 'transparent',
                color: '#79502A',
                fontSize: 12,
                cursor: 'pointer'
              }}
            >
              {mode === 'list' ? 'List' : 'Calendar'}
            </button>
          ))}
        </div>
      </header>

      {view === 'calendar' && (
        <section
          aria-label={flow === 'out' ? 'Monthly total due' : 'Monthly total incoming'}
          style={{
            ...card,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '11px 14px',
            background: '#F5D6A5'
          }}
        >
          <strong style={{ color: '#79502A', fontSize: 12, fontWeight: 600 }}>
            {flow === 'out' ? 'Money Out · Total Due' : 'Money In · Total Incoming'}
          </strong>
          <strong style={{
            color: '#493320',
            fontSize: 16,
            whiteSpace: 'nowrap',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {money(calendarTotal)}
          </strong>
        </section>
      )}

      <section style={card}>
        {view === 'list' && (
          <label style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 7,
            marginBottom: 8,
            color: '#79502A',
            fontSize: 11,
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              aria-label="Show Completed"
              checked={showCompleted}
              onChange={event => setShowCompleted(event.target.checked)}
            />
            Show Completed
          </label>
        )}
        {view === 'calendar' ? (
          <>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 8
            }}>
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => {
                  const previous = addMonths(selectedMonth, -1)
                  setSelectedMonth(previous)
                  setSelectedDay(firstDateOfMonth(previous))
                }}
                style={{ border: 'none', background: 'transparent', color: '#B87522', fontSize: 22, cursor: 'pointer' }}
              >
                ‹
              </button>
              <h2 style={{ margin: 0, color: '#493320', fontSize: 17 }}>{monthLabel(selectedMonth)}</h2>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => {
                  const next = addMonths(selectedMonth, 1)
                  setSelectedMonth(next)
                  setSelectedDay(firstDateOfMonth(next))
                }}
                style={{ border: 'none', background: 'transparent', color: '#B87522', fontSize: 22, cursor: 'pointer' }}
              >
                ›
              </button>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gap: 3,
              textAlign: 'center'
            }}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <strong key={`${day}-${index}`} style={{ padding: 5, color: '#79502A', fontSize: 11 }}>
                  {day}
                </strong>
              ))}
              {calendarCells.map(cell => cell.day ? (
                <button
                  key={cell.key}
                  type="button"
                  aria-label={`${cell.date}${cell.hasItems ? (flow === 'out' ? ', bills due' : ', income expected') : ''}`}
                  aria-pressed={selectedDay === cell.date}
                  onClick={() => setSelectedDay(cell.date)}
                  style={{
                    position: 'relative',
                    minWidth: 0,
                    height: 38,
                    border: 'none',
                    borderRadius: 10,
                    background: selectedDay === cell.date ? '#F5D6A5' : 'transparent',
                    color: '#493320',
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  {cell.day}
                  {cell.hasItems && (
                    <span style={{
                      position: 'absolute',
                      bottom: 4,
                      left: '50%',
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: flow === 'out' ? '#B87522' : '#21834B',
                      transform: 'translateX(-50%)'
                    }} />
                  )}
                </button>
              ) : <span key={cell.key} />)}
            </div>
            <section aria-live="polite" style={{ marginTop: 16 }}>
              <h2 style={{ margin: '0 0 4px', fontSize: 13, color: '#79502A' }}>
                Entries · {formatDueDate(selectedDay)}
              </h2>
              {selectedDayOccurrences.length ? (
                selectedDayOccurrences.map(item => renderOccurrenceRow(
                  item,
                  flow,
                  openOccurrenceForEdit,
                  handleOccurrenceAction,
                  handleSkipOccurrence
                ))
              ) : (
                <p style={{ margin: '7px 0 0', color: '#79502A', fontSize: 12 }}>
                  Nothing scheduled for this date.
                </p>
              )}
            </section>
          </>
        ) : (
          <>
            {listMonths.length ? listMonths.map(group => (
              <section
                key={group.monthKey}
                ref={group.monthKey === initialScrollMonthKey ? currentMonthRef : undefined}
                aria-label={`${monthLabel(group.month)} ${flow === 'out' ? 'bills' : 'income'}`}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  margin: '0 -6px 3px',
                  padding: '8px 10px',
                  borderRadius: 9,
                  background: '#F5D6A5',
                  color: '#79502A'
                }}>
                  <h2 style={{ margin: 0, fontSize: 13 }}>{monthLabel(group.month)}</h2>
                  <strong style={{ fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                    Total scheduled · {money(group.total)}
                  </strong>
                </div>
                {group.visibleOccurrences.map(item => renderOccurrenceRow(
                  item,
                  flow,
                  openOccurrenceForEdit,
                  handleOccurrenceAction,
                  handleSkipOccurrence
                ))}
              </section>
            )) : (
              <p style={{ color: '#79502A', fontSize: 13 }}>
                Nothing scheduled in this date range.
              </p>
            )}
            {inactiveSchedules.length > 0 && (
              <section aria-label="Inactive schedules" style={{ marginTop: 16 }}>
                <h2 style={{ margin: '0 0 4px', color: '#79502A', fontSize: 13 }}>
                  Inactive schedules
                </h2>
                {inactiveSchedules.map(schedule => renderOccurrenceRow(
                  {
                    ...schedule,
                    occurrenceId: `schedule:${schedule.id}`,
                    status: schedule.archived ? 'archived' : 'paused',
                    dueDate: schedule.dueDate,
                    scheduledDate: schedule.dueDate
                  },
                  flow,
                  openOccurrenceForEdit,
                  handleOccurrenceAction,
                  handleSkipOccurrence
                ))}
              </section>
            )}
          </>
        )}
      </section>

      <button
        type="button"
        aria-label={flow === 'out' ? 'Add bill' : 'Add income'}
        title={flow === 'out' ? 'Add Bill' : 'Add Income'}
        onClick={openNewBill}
        style={{
          position: 'fixed',
          right: 'max(20px, calc((100vw - 460px) / 2))',
          bottom: 'calc(100px + env(safe-area-inset-bottom))',
          zIndex: 20,
          width: 58,
          height: 58,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          borderRadius: '50%',
          background: '#B87522',
          color: '#FFFFFF',
          boxShadow: '0 4px 14px #76552255',
          fontSize: 32,
          lineHeight: 1,
          cursor: 'pointer'
        }}
      >
        +
      </button>

      {selectedOccurrence && (
        <div
          onMouseDown={event => {
            if (event.target === event.currentTarget) setSelectedOccurrence(null)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '16px 16px env(safe-area-inset-bottom)',
            background: '#33231266'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-date-title"
            style={{
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: 460,
              padding: 20,
              borderRadius: '20px 20px 16px 16px',
              background: '#FFF8ED',
              boxShadow: '0 8px 30px #33231233'
            }}
          >
            <h2 id="payment-date-title" style={{ margin: '0 0 5px', color: '#79502A', fontSize: 19 }}>
              {flow === 'out' ? 'Record payment' : 'Record income'}
            </h2>
            <p style={{ margin: '0 0 14px', color: '#79502A', fontSize: 13 }}>
              {selectedOccurrence.name} · {money(selectedOccurrence.amount)}
            </p>
            {flow === 'out' && !paymentAccountIsAvailable && (
              <label style={{ display: 'grid', gap: 6, marginBottom: 12, color: '#79502A', fontSize: 12 }}>
                Account for this payment
                <select
                  aria-label="Payment account"
                  value={paymentAccountId}
                  onChange={event => setPaymentAccountId(event.target.value)}
                  style={field}
                  required
                >
                  <option value="">Choose account</option>
                  {accountOptions.map(account => (
                    <option key={account.id} value={account.id}>{account.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ display: 'grid', gap: 6, marginBottom: 12, color: '#79502A', fontSize: 12 }}>
              {flow === 'out' ? 'Actual payment date' : 'Actual received date'}
              <input
                aria-label={flow === 'out' ? 'Actual payment date' : 'Actual received date'}
                type="date"
                value={actualDate}
                onChange={event => setActualDate(event.target.value)}
                style={field}
              />
            </label>
            {selectedOccurrenceDebt && (
              <p style={{ margin: '0 0 12px', color: '#79502A', fontSize: 12 }}>
                {getDebtPaymentCalculationMethod(selectedOccurrenceDebt) === DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
                  ? `This payment will reduce ${selectedOccurrenceDebt.name}'s balance by the payment amount, up to the remaining balance.`
                  : `This payment will be recorded without guessing principal. Review ${selectedOccurrenceDebt.name}'s balance after accounting for interest.`}
              </p>
            )}
            {occurrenceError && (
              <p role="alert" style={{ margin: '0 0 10px', color: '#9B463E', fontSize: 12 }}>
                {occurrenceError}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                onClick={() => setSelectedOccurrence(null)}
                style={{ ...field, color: '#79502A', fontWeight: 'bold', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmOccurrencePayment}
                style={{
                  ...field,
                  border: 'none',
                  background: '#B87522',
                  color: '#FFFFFF',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Confirm
              </button>
            </div>
          </section>
        </div>
      )}

      {isFormOpen && (
        <div
          onMouseDown={event => {
            if (event.target === event.currentTarget) setIsFormOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 30,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '16px 16px env(safe-area-inset-bottom)',
            background: '#33231266'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="bill-form-title"
            style={{
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: 460,
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: 20,
              borderRadius: '20px 20px 16px 16px',
              background: '#FFF8ED',
              boxShadow: '0 8px 30px #33231233'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h2 id="bill-form-title" style={{ margin: 0, color: '#79502A' }}>
                {editingScope === 'occurrence'
                  ? `Edit ${flow === 'out' ? 'bill' : 'income'} occurrence`
                  : editingBillId !== null
                  ? `Edit ${flow === 'out' ? 'bill' : 'income'} schedule`
                  : flow === 'out'
                  ? 'Add Bill'
                  : 'Add Income'}
              </h2>
              <button
                type="button"
                aria-label="Close bill form"
                onClick={() => setIsFormOpen(false)}
                style={{ border: 'none', background: 'transparent', color: '#79502A', fontSize: 24, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            <form onSubmit={saveBill} style={{ display: 'grid', gap: 10 }}>
              {editingBillId !== null && editingOccurrence && editingSchedule?.frequency !== 'one-time' && (
                <fieldset style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 8,
                  margin: 0,
                  padding: 10,
                  border: '1px solid #E9D6B7',
                  borderRadius: 10
                }}>
                  <legend style={{ padding: '0 4px', color: '#79502A', fontSize: 12 }}>
                    Apply changes to
                  </legend>
                  {[
                    ['occurrence', 'This occurrence'],
                    ['schedule', 'Recurring schedule']
                  ].map(([scope, label]) => (
                    <label key={scope} style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#79502A',
                      fontSize: 12
                    }}>
                      <input
                        type="radio"
                        name="edit-scope"
                        value={scope}
                        checked={editingScope === scope}
                        onChange={() => selectEditingScope(scope)}
                      />
                      {label}
                    </label>
                  ))}
                </fieldset>
              )}
              <input aria-label={flow === 'out' ? 'Bill name' : 'Income name'} placeholder={flow === 'out' ? 'Bill name' : 'Income name'} value={name} onChange={event => setName(event.target.value)} style={field} required />
              <input aria-label="Amount" type="number" min="0.01" step="0.01" placeholder="Amount" value={amount} onChange={event => setAmount(event.target.value)} style={field} required />
              <input aria-label={flow === 'out' ? 'Due date' : 'First expected date'} type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} style={field} required />
              {editingScope === 'schedule' && (
                <label style={{ display: 'grid', gap: 5, color: '#79502A', fontSize: 12 }}>
                  {editingBillId === null ? 'Schedule' : 'Recurring schedule'}
                  <select aria-label="Frequency" value={frequency} onChange={event => setFrequency(event.target.value)} style={field}>
                    {frequencies.map(value => (
                      <option key={value} value={value}>{value === 'one-time' ? 'One-time' : value[0].toUpperCase() + value.slice(1)}</option>
                    ))}
                  </select>
                </label>
              )}
              {frequency === 'twice-monthly' && editingScope === 'schedule' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {daysOfMonth.map((day, index) => (
                    <label key={index} style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 12 }}>
                      {index === 0 ? 'First day of month' : 'Second day of month'}
                      <input
                        type="number"
                        aria-label={index === 0 ? 'First day of month' : 'Second day of month'}
                        min="1"
                        max="31"
                        value={day}
                        onChange={event => setDaysOfMonth(daysOfMonth.map((item, itemIndex) =>
                          itemIndex === index ? event.target.value : item
                        ))}
                        style={field}
                        required
                      />
                    </label>
                  ))}
                </div>
              )}
              {editingBillId !== null && (
                <details style={{ color: '#79502A', fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Schedule & management</summary>
                  <p style={{ margin: '8px 0', fontSize: 11 }}>
                    Current schedule: {editingSchedule?.frequency ?? 'one-time'}.
                    {editingScope === 'occurrence'
                      ? ' This form edits only the selected date.'
                      : ' Schedule changes apply to future occurrences.'}
                  </p>
                  <div style={{ display: 'grid', gap: 7 }}>
                    {editingSchedule?.archived ? (
                      <button type="button" onClick={() => updateScheduleManagement({ archived: false, active: true })} style={{
                        ...field, color: '#79502A', cursor: 'pointer'
                      }}>
                        Restore schedule
                      </button>
                    ) : editingSchedule?.active === false ? (
                      <button type="button" onClick={() => updateScheduleManagement({ active: true })} style={{
                        ...field, color: '#79502A', cursor: 'pointer'
                      }}>
                        Resume schedule
                      </button>
                    ) : (
                      <button type="button" onClick={() => updateScheduleManagement({ active: false })} style={{
                        ...field, color: '#79502A', cursor: 'pointer'
                      }}>
                        Pause schedule
                      </button>
                    )}
                    {!editingSchedule?.archived && (
                      <button type="button" onClick={() => updateScheduleManagement({ archived: true, active: false })} style={{
                        ...field, color: '#9B463E', cursor: 'pointer'
                      }}>
                        Archive schedule
                      </button>
                    )}
                  </div>
                </details>
              )}
              {flow === 'out' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#79502A', fontSize: 13 }}>
                <input type="checkbox" checked={autopay} onChange={event => setAutopay(event.target.checked)} />
                Autopay
                </label>
              )}
              {flow === 'out'
                && editingScope === 'schedule'
                && (frequency !== 'one-time' || linkedDebtId !== '')
                && (
                <label style={{ display: 'grid', gap: 5, color: '#79502A', fontSize: 12 }}>
                  Linked debt
                  <select
                    aria-label="Linked debt"
                    value={linkedDebtId}
                    onChange={event => setLinkedDebtId(event.target.value)}
                    style={field}
                  >
                    <option value="">No debt linked</option>
                    {debts.map(debt => (
                      <option key={debt.id} value={debt.id}>{debt.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {flow === 'in' && (
                <textarea
                  aria-label="Notes"
                  placeholder="Optional notes"
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  rows={2}
                  style={{ ...field, resize: 'vertical' }}
                />
              )}
              {formError && <p role="alert" style={{ margin: 0, color: '#9B463E', fontSize: 12 }}>{formError}</p>}
              <select aria-label="Associated account" value={accountId} onChange={event => setAccountId(event.target.value)} style={field}>
                <option value="">No account linked</option>
                {accountOptions.map(account => (
                  <option key={account.id} value={account.id}>{account.name}</option>
                ))}
              </select>
              <p style={{ margin: 0, color: '#79502A', fontSize: 11 }}>
                {flow === 'out'
                  ? 'Marking Paid records one uncleared expense in the associated account.'
                  : 'Marking Received records one uncleared deposit in the associated account.'}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" onClick={() => setIsFormOpen(false)} style={{
                  ...field,
                  color: '#79502A',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}>
                  Cancel
                </button>
                <button type="submit" style={{
                  ...field,
                  border: 'none',
                  background: '#B87522',
                  color: '#FFFFFF',
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}>
                  {flow === 'out'
                    ? editingBillId === null ? 'Add Bill' : 'Save Bill'
                    : editingBillId === null ? 'Add Income' : 'Save Income'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {isLinkDialogOpen && linkingOccurrence && (
        <div
          onMouseDown={event => {
            if (event.target === event.currentTarget) setIsLinkDialogOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 31,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            padding: '16px 16px env(safe-area-inset-bottom)',
            background: '#33231266'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-income-title"
            style={{
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: 460,
              padding: 20,
              borderRadius: '20px 20px 16px 16px',
              background: '#FFF8ED'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 id="link-income-title" style={{ margin: 0, color: '#79502A', fontSize: 18 }}>
                Link Existing Transaction
              </h2>
              <button type="button" aria-label="Close link dialog" onClick={() => setIsLinkDialogOpen(false)} style={{
                border: 'none', background: 'transparent', color: '#79502A', fontSize: 24, cursor: 'pointer'
              }}>×</button>
            </div>
            <p style={{ color: '#79502A', fontSize: 12 }}>
              A matching transaction already exists. Link it to this occurrence instead of creating another.
            </p>
            <form onSubmit={linkExistingTransaction} style={{ display: 'grid', gap: 10 }}>
              <select
                aria-label="Existing account transaction"
                value={selectedTransactionId}
                onChange={event => setSelectedTransactionId(event.target.value)}
                style={field}
                required
              >
                <option value="">Select a transaction</option>
                {transactionOptions.map(transaction => (
                  <option key={transaction.id} value={transaction.id}>
                    {transaction.name} · {money(transaction.amount)} · {transaction.date} · {accountOptions.find(account => account.id === transaction.accountId)?.name ?? 'Unknown account'}
                  </option>
                ))}
              </select>
              {transactionOptions.length === 0 && (
                <span style={{ color: '#79502A', fontSize: 12 }}>No matching account transactions are available.</span>
              )}
              {linkError && <p role="alert" style={{ margin: 0, color: '#9B463E', fontSize: 12 }}>{linkError}</p>}
              {linkError.includes('associated account') && (
                <button
                  type="button"
                  onClick={() => {
                    setIsLinkDialogOpen(false)
                    openEditBill(linkingOccurrence)
                  }}
                  style={smallAction}
                >
                  Edit schedule
                </button>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button type="button" onClick={() => setIsLinkDialogOpen(false)} style={smallAction}>Cancel</button>
                <button type="submit" disabled={!selectedTransactionId} style={{
                  ...smallAction,
                  border: 'none',
                  background: '#B87522',
                  color: '#FFFFFF',
                  fontWeight: 'bold',
                  opacity: selectedTransactionId ? 1 : 0.6
                }}>
                  Link transaction
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  )
}

function renderOccurrenceRow(
  occurrence,
  flow,
  onOpen,
  onAction,
  onSkip
) {
  const isIncome = flow === 'in'
  const isInactive = occurrence.status === 'paused' || occurrence.status === 'archived'
  const isRecorded = isIncome
    ? occurrence.status === 'received'
    : occurrence.paid === true
  const isSkipped = flow === 'out' && occurrence.skipped === true
  const canSkip = flow === 'out' && occurrence.debtId != null && !isRecorded && !isInactive
  const actionLabel = isIncome ? 'Receive' : 'Pay'
  const recordedLabel = isIncome ? 'Received' : 'Paid'
  const openRow = () => onOpen(occurrence)

  return (
    <div
      key={occurrence.occurrenceId}
      role="group"
      tabIndex={0}
      aria-label={`${isIncome ? 'Income' : 'Bill'} row: ${occurrence.name}`}
      onClick={openRow}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openRow()
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 8,
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        padding: '7px 0',
        borderBottom: '1px solid #EEE5D9',
        background: 'transparent',
        color: '#493320',
        textAlign: 'left',
        cursor: 'pointer'
      }}
    >
      <span style={{ display: 'block', minWidth: 0 }}>
        <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {occurrence.name}
        </strong>
        <span style={{ display: 'block', marginTop: 2, color: '#79502A', fontSize: 11 }}>
          {formatDueDate(occurrence.dueDate)}
        </span>
      </span>
      <div style={{ minWidth: 80, display: 'grid', justifyItems: 'end', gap: 3 }}>
        <strong style={{
          color: isIncome ? '#21834B' : '#493320',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {money(occurrence.amount)}
        </strong>
        <button
          type="button"
          aria-label={`${isRecorded ? recordedLabel : actionLabel} ${occurrence.name}`}
          aria-pressed={isRecorded}
          onClick={event => {
            event.stopPropagation()
            onAction(occurrence)
          }}
          disabled={isInactive && !isRecorded}
          style={{
            border: 'none',
            borderRadius: 9,
            padding: '5px 10px',
            background: isRecorded ? '#D8EFDF' : '#F1EEE9',
            color: isRecorded ? '#21834B' : '#625B53',
            fontSize: 11,
            fontWeight: 'bold',
            cursor: isInactive && !isRecorded ? 'default' : 'pointer',
            opacity: isInactive && !isRecorded ? 0.6 : 1
          }}
        >
          {isRecorded ? recordedLabel : actionLabel}
        </button>
        {isSkipped && (
          <span style={{ color: '#9B7955', fontSize: 10, fontWeight: 'bold' }}>Skipped</span>
        )}
        {canSkip && (
          <button
            type="button"
            aria-label={isSkipped ? `Undo Skip ${occurrence.name}` : `Skip Payment ${occurrence.name}`}
            onClick={event => {
              event.stopPropagation()
              onSkip(occurrence)
            }}
            style={{
              border: 'none',
              borderRadius: 8,
              padding: '4px 8px',
              background: isSkipped ? '#F5E9D7' : 'transparent',
              color: '#79502A',
              fontSize: 10,
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            {isSkipped ? 'Undo Skip' : 'Skip Payment'}
          </button>
        )}
      </div>
    </div>
  )
}
