import { useEffect, useState } from 'react'
import {
  createIncomeId,
  createBillId,
  createDemoBills,
  formatLocalDate,
  getIncomeOccurrences,
  getScheduleViewData,
  getScheduleSummary,
  getBillOccurrences,
  loadBillData,
  saveBillData,
  updateIncomeStatus,
  updateScheduleOccurrence
} from './billData.js'
import {
  createOccurrenceTransaction,
  linkExistingOccurrenceTransaction,
  loadSavedAccountData,
  saveAccountData,
  unlinkOccurrenceTransaction,
  updateOccurrenceTransaction,
  updateOccurrenceTransactions
} from './accountStorage.js'

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

function formatDueDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  })
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
  const accountOptions = accountData?.accounts.filter(account => !account.archived) ?? []
  const accountTransactions = accountData?.transactions ?? []
  const [flow, setFlow] = useState('out')
  const [selectedMonth, setSelectedMonth] = useState(() => monthStart(new Date()))
  const [view, setView] = useState('list')
  const [selectedDay, setSelectedDay] = useState(today)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingBillId, setEditingBillId] = useState(null)
  const [editingScope, setEditingScope] = useState('schedule')
  const [editingOccurrenceDate, setEditingOccurrenceDate] = useState(null)
  const [editingLinkedTransactionId, setEditingLinkedTransactionId] = useState(null)
  const [selectedOccurrence, setSelectedOccurrence] = useState(null)
  const [actualDate, setActualDate] = useState(today)
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
  const scheduleView = getScheduleViewData(flow, billOccurrences, incomeOccurrences, selectedDay, view)
  const { occurrences: visibleOccurrences, selectedDayOccurrences, calendarDates } = scheduleView
  const summary = getScheduleSummary(flow, billOccurrences, incomeOccurrences, today)
  const editingSchedule = (flow === 'out' ? bills : incomes)
    .find(schedule => schedule.id === editingBillId)
  const monthDays = new Date(Date.UTC(
    selectedMonth.getUTCFullYear(),
    selectedMonth.getUTCMonth() + 1,
    0
  )).getUTCDate()
  const firstWeekday = selectedMonth.getUTCDay()

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

  function updateBills(nextBills) {
    persistData(nextBills, incomes)
  }

  function updateIncomes(nextIncomes) {
    persistData(bills, nextIncomes)
  }

  function openNewBill() {
    setEditingBillId(null)
    setEditingScope('schedule')
    setEditingOccurrenceDate(null)
    setEditingLinkedTransactionId(null)
    setName('')
    setAmount('')
    setDueDate(today)
    setFrequency(flow === 'in' ? 'monthly' : 'one-time')
    setAutopay(false)
    setAccountId('')
    setNotes('')
    setDaysOfMonth(['1', '15'])
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
    setName(savedBill.name)
    setAmount(String(savedBill.amount))
    setDueDate(savedBill.dueDate)
    setFrequency(savedBill.frequency)
    setAutopay(savedBill.autopay)
    setAccountId(savedBill.accountId == null ? '' : String(savedBill.accountId))
    setNotes(savedBill.notes ?? '')
    setDaysOfMonth((savedBill.daysOfMonth ?? [1, 15]).map(String))
    setFormError('')
    setIsFormOpen(true)
  }

  function openEditOccurrence(occurrence) {
    const savedSchedule = flow === 'out'
      ? bills.find(item => item.id === occurrence.id) ?? occurrence
      : incomes.find(item => item.id === occurrence.id) ?? occurrence
    setEditingBillId(savedSchedule.id)
    setEditingScope('occurrence')
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

  function openPaymentConfirmation(occurrence) {
    setSelectedOccurrence(occurrence)
    setActualDate(today)
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
    const occurrence = selectedOccurrence

    try {
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
      updateBills(bills.map(bill => bill.id === occurrence.id
        ? (() => {
          const history = bill.paymentHistory ?? []
          if (history.at(-1)?.transactionId === transactionId) return bill
          return {
            ...bill,
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
      if (income?.paymentHistory?.at(-1)?.transactionId === transactionId) return
      const updated = updateIncomeStatus(income, scheduledDate, 'received', new Date().toISOString(), transactionId)
      updateIncomes(incomes.map(item => item.id === occurrence.id ? updated : item))
    }
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
        if (accountId === '') {
          setFormError('Choose an associated account to keep the linked transaction valid.')
          return
        }
        const shouldUpdateTransaction = window.confirm(
          'This occurrence is linked to an account transaction. Update that transaction’s amount, date, and account to match these changes?'
        )
        if (!shouldUpdateTransaction) {
          setFormError('The linked transaction was not changed; cancel or confirm the matching transaction update.')
          return
        }
        try {
          updateOccurrenceTransaction(editingLinkedTransactionId, {
            accountId: accountId === '' ? null : Number(accountId),
            name: name.trim(),
            amount: flow === 'out' ? -numericAmount : numericAmount,
            date: dueDate
          })
          setAccountData(loadSavedAccountData())
        } catch (error) {
          setFormError(error.message)
          return
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
          setAccountData(loadSavedAccountData())
        } catch (error) {
          setFormError(error.message)
          return
        }
      }
    }

    if (flow === 'out' && editingBillId !== null) {
      updateBills(bills.map(bill => bill.id === editingBillId
        ? {
          ...bill,
          name: name.trim(),
          amount: numericAmount,
          dueDate,
          frequency,
          autopay,
          accountId: accountId === '' ? null : Number(accountId),
          notes: notes.trim(),
          daysOfMonth: frequency === 'twice-monthly' ? selectedDays : []
        }
        : bill
      ))
    } else if (flow === 'out') {
      updateBills([...bills, {
        id: createBillId(bills),
        name: name.trim(),
        amount: numericAmount,
        dueDate,
        frequency,
        autopay,
        accountId: accountId === '' ? null : Number(accountId),
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

      <section style={{
        ...card,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: 8,
        padding: 14,
        background: '#F5D6A5'
      }}>
        {[
          [summary.firstLabel, summary.firstValue, '#B87522'],
          [summary.secondLabel, summary.secondValue, '#21834B'],
          [summary.thirdLabel, summary.thirdValue, '#9B463E']
        ].map(([label, total, color]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ color: '#79502A', fontSize: 10, fontWeight: 'bold', letterSpacing: 0.3 }}>
              {label}
            </div>
            <strong style={{
              display: 'block',
              marginTop: 5,
              color,
              fontSize: 15,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {money(total)}
            </strong>
          </div>
        ))}
      </section>

      <section style={card}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 14
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

        {view === 'calendar' ? (
          <>
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
              <h2 style={{ margin: '0 0 4px', fontSize: 15 }}>
                {flow === 'out' ? 'Bills' : 'Incoming'} · {formatDueDate(selectedDay)}
              </h2>
              {selectedDayOccurrences.length ? (
                selectedDayOccurrences.map(item => renderOccurrenceRow(
                  item,
                  flow,
                  accountOptions,
                  openOccurrenceForEdit,
                  openPaymentConfirmation
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
            <h2 style={{ margin: 0, fontSize: 17 }}>Scheduled Items</h2>
            {visibleOccurrences.length
              ? visibleOccurrences.map(item => renderOccurrenceRow(
                item,
                flow,
                accountOptions,
                openOccurrenceForEdit,
                openPaymentConfirmation
              ))
              : <p style={{ color: '#79502A', fontSize: 13 }}>
                Nothing scheduled this month.
              </p>}
            {(flow === 'in' ? incomes : bills).filter(schedule => schedule.archived || schedule.active === false).map(schedule => (
              renderOccurrenceRow(
                {
                  ...schedule,
                  occurrenceId: `schedule:${schedule.id}`,
                  status: schedule.archived ? 'archived' : 'paused',
                  dueDate: schedule.dueDate,
                  scheduledDate: schedule.dueDate
                },
                flow,
                accountOptions,
                openOccurrenceForEdit,
                openPaymentConfirmation
              )
            ))}
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
                    {editingScope === 'occurrence' && editingSchedule?.frequency !== 'one-time' && (
                      <button
                        type="button"
                        onClick={() => openEditBill(editingSchedule)}
                        style={{ ...field, color: '#79502A', cursor: 'pointer' }}
                      >
                        Edit recurring schedule
                      </button>
                    )}
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
              {editingLinkedTransactionId !== null && editingScope === 'occurrence' && (
                <details style={{ color: '#79502A', fontSize: 12 }}>
                  <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>Advanced linked transaction settings</summary>
                  <p style={{ margin: '8px 0', fontSize: 11 }}>
                    Payment status and clearing follow this linked transaction. Clearing remains in Accounts.
                  </p>
                  <div style={{ display: 'grid', gap: 7 }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm('Unlink this occurrence? The account transaction will remain in the register.')) return
                        try {
                          unlinkOccurrenceTransaction(editingLinkedTransactionId)
                          setAccountData(loadSavedAccountData())
                          setEditingLinkedTransactionId(null)
                        } catch (error) {
                          setFormError(error.message)
                        }
                      }}
                      style={{ ...field, color: '#9B463E', cursor: 'pointer' }}
                    >
                      Unlink and keep transaction
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm('Reverse this payment by deleting its linked account transaction? This changes the account balance.')) return
                        try {
                          const nextTransactions = accountTransactions.filter(item => item.id !== editingLinkedTransactionId)
                          saveAccountData(accountData.accounts, nextTransactions)
                          setAccountData(loadSavedAccountData())
                          setEditingLinkedTransactionId(null)
                        } catch (error) {
                          setFormError(error.message)
                        }
                      }}
                      style={{ ...field, color: '#9B463E', cursor: 'pointer' }}
                    >
                      Reverse and remove transaction
                    </button>
                  </div>
                </details>
              )}
              {flow === 'out' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#79502A', fontSize: 13 }}>
                <input type="checkbox" checked={autopay} onChange={event => setAutopay(event.target.checked)} />
                Autopay
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
  accountOptions,
  onOpen,
  onPay
) {
  const isIncome = flow === 'in'
  const linkedAccount = accountOptions.find(account => account.id === occurrence.accountId)
  const isInactive = occurrence.status === 'paused' || occurrence.status === 'archived'
  const isRecorded = isIncome ? occurrence.status === 'received' : occurrence.paid
  const actionLabel = isIncome ? 'Receive' : 'Pay'
  const recordedLabel = isIncome ? 'Received' : 'Paid'
  const rowStatus = occurrence.status === 'archived'
    ? 'Archived'
    : occurrence.status === 'paused'
      ? 'Paused'
      : isRecorded ? recordedLabel : null
  const openRow = () => onOpen(occurrence)

  return (
    <div
      key={occurrence.occurrenceId}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${occurrence.name}`}
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
        gap: 12,
        alignItems: 'center',
        width: '100%',
        minWidth: 0,
        padding: '9px 0',
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
        <span style={{ display: 'block', marginTop: 3, color: '#79502A', fontSize: 11 }}>
          {formatDueDate(occurrence.dueDate)}
        </span>
        <span style={{ display: 'block', marginTop: 2, color: '#9B7955', fontSize: 10 }}>
          {linkedAccount?.name ?? 'No account linked'}
        </span>
      </span>
      <div style={{ minWidth: 80, display: 'grid', justifyItems: 'end', gap: 5 }}>
        <strong style={{
          color: isIncome ? '#21834B' : '#493320',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {money(occurrence.amount)}
        </strong>
        {rowStatus ? (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 9px',
            borderRadius: 999,
            background: isRecorded ? '#D8EFDF' : '#F1EEE9',
            color: isRecorded ? '#21834B' : '#79502A',
            fontSize: 11,
            fontWeight: 'bold',
            whiteSpace: 'nowrap'
          }}>
            {isRecorded && <span aria-hidden="true">✓</span>}
            {rowStatus}
          </span>
        ) : (
          <button
            type="button"
            aria-label={`${isIncome ? 'Receive' : 'Pay'} ${occurrence.name}`}
            onClick={event => {
              event.stopPropagation()
              onPay(occurrence)
            }}
            disabled={isInactive}
            style={{
              border: 'none',
              borderRadius: 9,
              padding: '5px 10px',
              background: '#F1EEE9',
              color: '#625B53',
              fontSize: 11,
              fontWeight: 'bold',
              cursor: isInactive ? 'default' : 'pointer',
              opacity: isInactive ? 0.6 : 1
            }}
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  )
}
