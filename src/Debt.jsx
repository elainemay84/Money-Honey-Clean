import { useEffect, useRef, useState } from 'react'
import ResponsiveText from './ResponsiveText'
import StatementAutofill from './StatementAutofill'
import FinancialInput from './FinancialInput'
import DebtScheduleFields from './DebtScheduleFields'
import PaymentPlanFields from './PaymentPlanFields'
import { getCategories, loadCategoryConfig } from './categoryData.js'
import { defaultSchedule, generatePaymentPlan, getDebtInstallmentProgress, getDebtScheduledPayments, getInstallmentStatus, getPaidInstallmentNumbers, PAYMENT_FREQUENCY_OPTIONS, scheduleFromForm, sortPaymentPlanInstallments, validatePaymentSchedule } from './debtSchedule.js'
import { parseFinancialAmount } from './financialAmounts.js'
import { resolveScannedMonthlyDates } from './statementData.js'
import { loadSavedAccountData } from './accountStorage.js'
import { getTodayDate, loadBillData } from './billData.js'
import {
  applyPrincipalOnlyToReviewPayments,
  addDebtAssignee,
  calculateOverallDebtSummary,
  DEBT_PAYMENT_CALCULATION_METHODS,
  createDebtId,
  debtPaymentNeedsBalanceReview,
  deleteDebt,
  deleteDebtAssignee,
  getDebtPaymentCalculationMethod,
  getDebtPaymentHistory,
  getAvailableCredit,
  getDebtAssignee,
  getMatchingDebtBill,
  getDebtScheduleStatus,
  getDebtProgress,
  getDebtRemainingPercent,
  getDebtTypes,
  getDebtDeletionLinks,
  isDebtPaidOff,
  loadDebtData,
  renameDebtAssignee,
  saveDebts,
  synchronizeDebtBills,
  validateDebt
} from './debtData.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
function displayDate(date) {
  if (!date) return '—'
  const parsed = new Date(`${date}T00:00:00Z`)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : date
}
const inputStyle = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  minHeight: 42,
  padding: '8px 10px',
  border: '1px solid #E9D6B7',
  borderRadius: 10,
  background: '#FFFFFF'
}
const formLabel = {
  display: 'grid',
  gap: 4,
  color: '#79502A',
  fontSize: 12,
  lineHeight: 1.35
}
const dialog = {
  boxSizing: 'border-box',
  width: '100%',
  maxWidth: 460,
  maxHeight: '90dvh',
  overflow: 'auto',
  padding: 20,
  borderRadius: '20px 20px 16px 16px',
  background: '#FFF8ED'
}
const detailsDialog = {
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  maxWidth: 420,
  maxHeight: '88dvh',
  overflowY: 'auto',
  padding: 16,
  borderRadius: '18px 18px 16px 16px',
  background: '#FFF8ED'
}
const overlay = {
  position: 'fixed',
  inset: 0,
  zIndex: 30,
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  padding: '16px 16px env(safe-area-inset-bottom)',
  background: '#33231266'
}
const detailGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px 14px' }

function blankDebt() {
  return {
    name: '',
    purchaseCategory: '',
    type: 'Credit Card',
    startingBalance: '',
    creditLimit: '',
    accountLast4: '',
    assignedTo: '',
    currentBalance: '',
    interestRate: '',
    minimumPayment: '',
    nextPaymentDue: '',
    paymentCalculationMethod: DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY,
    paymentSchedule: defaultSchedule(),
    paymentHistory: []
  }
}

export default function Debt({ statementExtractor } = {}) {
  const [initialDebtData] = useState(() => loadDebtData())
  const [debts, setDebts] = useState(initialDebtData.debts)
  const [assignees, setAssignees] = useState(initialDebtData.assignees)
  const [accountData, setAccountData] = useState(() => loadSavedAccountData())
  const [bills, setBills] = useState(() => loadBillData([]).bills)
  const [showArchived, setShowArchived] = useState(false)
  const [showPaidOff, setShowPaidOff] = useState(false)
  const [selectedDebtId, setSelectedDebtId] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [addMode, setAddMode] = useState(null)
  const [isNewPaymentPlan, setIsNewPaymentPlan] = useState(false)
  const [planTerms, setPlanTerms] = useState({ count: '4', firstDate: '', frequency: 'biweekly' })
  const [preservePlanRows, setPreservePlanRows] = useState(false)
  const addMenuRef = useRef(null)
  const statementDialogRef = useRef(null)
  const [statementReview, setStatementReview] = useState(null)
  const [editingDebtId, setEditingDebtId] = useState(null)
  const [formValues, setFormValues] = useState(blankDebt)
  const [paymentMethodWasSelected, setPaymentMethodWasSelected] = useState(false)
  const [formError, setFormError] = useState('')
  const [categoryConfig, setCategoryConfig] = useState(() => loadCategoryConfig())
  const expenseCategories = getCategories(categoryConfig.customCategories, 'expense', categoryConfig.builtInNames, categoryConfig.disabledBuiltIns)
  const [isAssigneeManagerOpen, setIsAssigneeManagerOpen] = useState(false)
  const [editingAssignee, setEditingAssignee] = useState(null)
  const [assigneeName, setAssigneeName] = useState('')
  const [assigneeError, setAssigneeError] = useState('')
  const visibleDebts = debts.filter(debt => showArchived || !debt.archived)
  const activeDebts = visibleDebts.filter(debt => debt.currentBalance !== 0)
  const paidOffDebts = visibleDebts.filter(debt => debt.currentBalance === 0)
  const debtSummary = calculateOverallDebtSummary(visibleDebts)
  const editingDebt = debts.find(debt => debt.id === editingDebtId) ?? null
  const editingDebtBill = editingDebt
    ? bills.find(bill => bill.id === editingDebt.billId || bill.debtId === editingDebt.id)
    : null
  const selectedDebt = debts.find(debt => debt.id === selectedDebtId) ?? null
  const selectedDebtBill = selectedDebt
    ? bills.find(bill => bill.id === selectedDebt.billId && bill.debtId === selectedDebt.id)
      ?? bills.find(bill => bill.debtId === selectedDebt.id)
    : null
  const selectedPaymentHistory = selectedDebt ? getDebtPaymentHistory(selectedDebt, selectedDebtBill) : []
  const selectedPaidNumbers = selectedDebt ? getPaidInstallmentNumbers(selectedDebt) : new Set()
  const selectedPendingInstallments = selectedDebt?.paymentSchedule?.kind === 'payment-plan'
    ? sortPaymentPlanInstallments(selectedDebt.paymentSchedule.installments)
      .filter(row => getInstallmentStatus(row) === 'pending' && !selectedPaidNumbers.has(row.installmentNumber))
    : []
  const selectedHasInstallments = selectedDebt?.paymentSchedule?.kind === 'payment-plan'
    || selectedDebt?.paymentSchedule?.totalInstallments != null
  const selectedFutureInstallments = selectedHasInstallments
    ? sortPaymentPlanInstallments(getDebtScheduledPayments(selectedDebt)
      .filter(row => !selectedPaidNumbers.has(row.installmentNumber) && row.dueDate >= getTodayDate()))
    : []
  const scheduleStatusFor = debt => getDebtScheduleStatus(
    debt,
    bills,
    accountData?.transactions ?? []
  )
  const scheduleStatusByDebt = new Map(visibleDebts.map(debt => [
    debt.id,
    scheduleStatusFor(debt)
  ]))
  const selectedScheduleStatus = selectedDebt ? scheduleStatusFor(selectedDebt) : null
  let formSchedule = formValues.paymentSchedule
  if (isNewPaymentPlan && !preservePlanRows) {
    try {
      formSchedule = generatePaymentPlan(formValues.currentBalance, planTerms.count, planTerms.firstDate, planTerms.frequency)
    } catch { /* Keep incomplete scanned rows visible until generation inputs are supplied. */ }
  }
  const isPlanForm = isNewPaymentPlan || formSchedule?.kind === 'payment-plan'
  let formScheduleStatus
  let schedulePreviewError = ''
  try {
    if (formSchedule) {
      const paymentSchedule = scheduleFromForm(formSchedule, formValues.nextPaymentDue)
      validatePaymentSchedule(paymentSchedule)
      formScheduleStatus = scheduleStatusFor({ ...formValues, paymentSchedule })
    }
  } catch (error) {
    schedulePreviewError = error.message
  }
  const selectedDueLabel = selectedScheduleStatus?.isDueToday
    ? 'Due Today'
    : displayDate(selectedScheduleStatus?.nextDueDate)
  let creditPreview = ''
  if (formValues.creditLimit !== '' && formValues.currentBalance !== '') {
    try {
      creditPreview = `Available credit: ${money(parseFinancialAmount(formValues.creditLimit, 'Credit limit') - parseFinancialAmount(formValues.currentBalance, 'Current balance'))}.`
    } catch (error) { creditPreview = error.message }
  }

  useEffect(() => {
    if (!['menu', 'plan-choice'].includes(addMode)) return
    const closeOutside = event => {
      if (!addMenuRef.current?.contains(event.target)) setAddMode(null)
    }
    const closeOnEscape = event => {
      if (event.key === 'Escape') {
        setAddMode(null)
        addMenuRef.current?.querySelector('[aria-expanded]')?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [addMode])

  useEffect(() => {
    if (!['scan', 'plan-scan'].includes(addMode)) return
    const scanner = statementDialogRef.current
    scanner.querySelector('button')?.focus()
    const handleKey = event => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAddMode(null)
        addMenuRef.current?.querySelector('button')?.focus()
      } else if (event.key === 'Tab') {
        const buttons = [...scanner.querySelectorAll('button:not(:disabled)')]
        const target = event.shiftKey ? buttons.at(-1) : buttons[0]
        const boundary = event.shiftKey ? buttons[0] : buttons.at(-1)
        if (document.activeElement === boundary || !scanner.contains(document.activeElement)) {
          event.preventDefault()
          target?.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [addMode])

  useEffect(() => {
    const refresh = () => {
      const data = loadDebtData()
      setDebts(data.debts)
      setAssignees(data.assignees)
    }
    const refreshAccounts = () => setAccountData(loadSavedAccountData())
    const refreshBills = () => setBills(loadBillData([]).bills)
    const refreshCategories = () => setCategoryConfig(loadCategoryConfig())
    window.addEventListener('money-honey-debts-updated', refresh)
    window.addEventListener('money-honey-bills-updated', refreshBills)
    window.addEventListener('money-honey-accounts-updated', refreshAccounts)
    window.addEventListener('storage', refresh)
    window.addEventListener('storage', refreshBills)
    window.addEventListener('money-honey-categories-updated', refreshCategories)
    synchronizeDebtBills()
    return () => {
      window.removeEventListener('money-honey-debts-updated', refresh)
      window.removeEventListener('money-honey-bills-updated', refreshBills)
      window.removeEventListener('money-honey-accounts-updated', refreshAccounts)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('storage', refreshBills)
      window.removeEventListener('money-honey-categories-updated', refreshCategories)
    }
  }, [])

  function openNewDebt() {
    setAddMode(null)
    setStatementReview(null)
    setSelectedDebtId(null)
    setEditingDebtId(null)
    setIsNewPaymentPlan(false)
    setFormValues(blankDebt())
    setPaymentMethodWasSelected(false)
    setFormError('')
    setIsFormOpen(true)
  }

  function openNewPaymentPlan() {
    openNewDebt()
    setIsNewPaymentPlan(true)
    setPlanTerms({ count: '4', firstDate: '', frequency: 'biweekly' })
    setPreservePlanRows(false)
    setFormValues({ ...blankDebt(), type: 'Other', paymentSchedule: { kind: 'payment-plan', frequency: 'explicit', installments: [] } })
  }

  function openEditDebt(debt) {
    setIsNewPaymentPlan(false)
    setStatementReview(null)
    setSelectedDebtId(null)
    setEditingDebtId(debt.id)
    setFormValues({
      ...debt,
      startingBalance: String(debt.startingBalance),
      creditLimit: debt.creditLimit == null ? '' : String(debt.creditLimit),
      accountLast4: debt.accountLast4 ?? '',
      assignedTo: getDebtAssignee(debt, assignees) ?? '',
      currentBalance: String(debt.currentBalance),
      interestRate: debt.interestRate == null ? '' : String(debt.interestRate),
      minimumPayment: debt.minimumPayment == null ? '' : String(debt.minimumPayment),
      nextPaymentDue: scheduleStatusFor(debt).nextDueDate,
      paymentCalculationMethod: getDebtPaymentCalculationMethod(debt)
    })
    setPaymentMethodWasSelected(true)
    setFormError('')
    setIsFormOpen(true)
  }

  function persistDebt(debt) {
    const previousDebt = debts.find(item => item.id === debt.id)
    let debtToSave = debt
    const unresolvedPayments = previousDebt?.paymentHistory.filter(payment =>
      debtPaymentNeedsBalanceReview(previousDebt, payment)
    ) ?? []
    if (
      previousDebt
      && getDebtPaymentCalculationMethod(previousDebt) !== DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
      && debt.paymentCalculationMethod === DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
      && unresolvedPayments.length
    ) {
      const paymentWord = unresolvedPayments.length === 1 ? 'payment' : 'payments'
      if (!window.confirm(
        `Apply the full amount of ${unresolvedPayments.length} unallocated ${paymentWord} to ${debt.name}'s balance? This updates its payment history and outstanding balance.`
      )) return
      debtToSave = applyPrincipalOnlyToReviewPayments(debt)
    }
    const nextDebts = editingDebtId === null
      ? [...debts, debtToSave]
      : debts.map(item => item.id === editingDebtId ? debtToSave : item)
    const billData = loadBillData([])
    const match = getMatchingDebtBill(billData.bills, debtToSave)
    const choices = {}
    if (match) {
      choices[debtToSave.id] = window.confirm(
        `A monthly bill named "${match.name}" for ${money(match.amount)} already exists. Link that bill to this debt instead of creating another?`
      ) ? match.id : false
    }
    saveDebts(nextDebts)
    const synchronized = synchronizeDebtBills(localStorage, choices)
    setDebts(synchronized.debts)
    setIsFormOpen(false)
  }

  function saveDebt(event) {
    event.preventDefault()
    const numeric = (value, label) => parseFinancialAmount(value, label, { optional: true })
    try {
      const values = { ...formValues }
      delete values.customAssignee
      if (isNewPaymentPlan && values.statementDetails) {
        values.statementDetails = Object.fromEntries(Object.entries(values.statementDetails)
          .filter(([, value]) => String(value ?? '').trim() !== '')
          .map(([key, value]) => [key, parseFinancialAmount(value, key)]))
      }
      if (isNewPaymentPlan && !preservePlanRows) {
        generatePaymentPlan(formValues.currentBalance, planTerms.count, planTerms.firstDate, planTerms.frequency)
      }
      const debt = validateDebt({
        ...values,
        id: editingDebtId ?? createDebtId(debts),
        startingBalance: isNewPaymentPlan
          ? parseFinancialAmount(formValues.startingBalance === '' ? formValues.currentBalance : formValues.startingBalance, 'Starting balance')
          : formValues.type === 'Credit Card' || formSchedule?.kind === 'pay-in-4'
          ? editingDebt?.startingBalance ?? parseFinancialAmount(formValues.currentBalance, 'Current balance')
          : parseFinancialAmount(formValues.startingBalance, 'Starting balance'),
        creditLimit: numeric(formValues.creditLimit, 'Credit limit'),
        currentBalance: parseFinancialAmount(formValues.currentBalance, 'Current balance'),
        interestRate: numeric(formValues.interestRate, 'APR'),
        minimumPayment: numeric(formValues.minimumPayment, 'Minimum payment'),
        ...(formSchedule ? { paymentSchedule: formSchedule === editingDebt?.paymentSchedule
          ? formSchedule : scheduleFromForm(formSchedule.kind === 'payment-plan'
            ? { ...formSchedule, installments: formSchedule.installments.map(({ scannedDate: _scannedDate, ...row }) => row) }
            : formSchedule, formValues.nextPaymentDue) } : {}),
        nextPaymentDue: formValues.nextPaymentDue || null
      })
      persistDebt(debt)
    } catch (error) {
      setFormError(error.message)
    }
  }

  function applyStatement(values, current, result = {}) {
    const updated = { ...current }
    const detailKeys = ['purchaseAmount', 'totalRepayment', 'totalInterest', 'amountAlreadyPaid', 'nextPaymentAmount']
    for (const [key, value] of Object.entries(values)) {
      if (detailKeys.includes(key)) updated.statementDetails = { ...updated.statementDetails, [key]: parseFinancialAmount(value, key) }
      else if (key === 'purchaseCategory') {
        updated.purchaseCategory = expenseCategories.find(category => category.toLowerCase() === value.toLowerCase()) ?? current.purchaseCategory ?? ''
      } else if (!['totalInstallments', 'completedInstallments'].includes(key)) updated[key] = value
    }
    // An installment plan's purchase amount is its original balance; never overwrite one already entered.
    if (values.purchaseAmount && updated.type && updated.type !== 'Credit Card' && !String(current.startingBalance ?? '').trim()) {
      updated.startingBalance = values.purchaseAmount
    }
    if (values.nextPaymentDue && updated.paymentSchedule && updated.paymentSchedule.kind !== 'payment-plan') {
      const next = editingDebt ? scheduleStatusFor(editingDebt).nextScheduledDate : null
      updated.paymentSchedule = next && current.paymentHistory.length
        ? { ...updated.paymentSchedule, dateAdjustments: [...(updated.paymentSchedule.dateAdjustments ?? []).filter(item => item.scheduledDate !== next), { scheduledDate: next, dueDate: values.nextPaymentDue }] }
        : { ...updated.paymentSchedule, startDate: values.nextPaymentDue }
    }
    if (Object.hasOwn(values, 'interestRate') && !paymentMethodWasSelected) {
      updated.paymentCalculationMethod = Number(values.interestRate) > 0
        ? DEBT_PAYMENT_CALCULATION_METHODS.MANUAL_PRINCIPAL : DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
    }
    if (result.installments?.length || addMode === 'plan-scan') {
      if (!current.paymentHistory.length && !(current.id != null && bills.some(bill => bill.debtId === current.id && bill.paymentHistory?.length))) {
        updated.paymentSchedule = { kind: 'payment-plan', frequency: 'explicit',
          installments: sortPaymentPlanInstallments((result.installments ?? []).map((row, index) => ({
            ...row, installmentNumber: index + 1, ...(result.dateHints?.[index] ? { scannedDate: result.dateHints[index] } : {})
          }))) }
      }
    } else if (values.provider && !editingDebt && current.paymentSchedule?.kind !== 'payment-plan' && !current.paymentHistory.length) {
      updated.paymentSchedule = { kind: 'payment-plan', frequency: 'explicit', installments: [] }
    }
    return updated
  }

  function changeNewPlanRows(installments) {
    setPreservePlanRows(true)
    setFormValues(current => ({ ...current, paymentSchedule: { ...current.paymentSchedule, installments: sortPaymentPlanInstallments(installments) } }))
  }

  function openAssigneeManager() {
    setEditingAssignee(null)
    setAssigneeName('')
    setAssigneeError('')
    setIsAssigneeManagerOpen(true)
  }

  function saveAssignee(event) {
    event.preventDefault()
    try {
      const data = editingAssignee === null
        ? addDebtAssignee(assigneeName)
        : renameDebtAssignee(editingAssignee, assigneeName)
      setDebts(data.debts)
      setAssignees(data.assignees)
      if (editingAssignee !== null) {
        setFormValues(values => ({
          ...values,
          assignedTo: values.assignedTo === editingAssignee ? assigneeName.trim() : values.assignedTo
        }))
      }
      setEditingAssignee(null)
      setAssigneeName('')
      setAssigneeError('')
    } catch (error) {
      setAssigneeError(error.message)
    }
  }

  function removeAssignee(name) {
    try {
      const current = loadDebtData()
      const count = current.debts.filter(debt => getDebtAssignee(debt, current.assignees) === name).length
      if (!window.confirm(
        `Delete "${name}"? ${count} ${count === 1 ? 'debt' : 'debts'} will be set to Unassigned. No debts, balances, or payment histories will be deleted or otherwise changed.`
      )) return
      const data = deleteDebtAssignee(name)
      setDebts(data.debts)
      setAssignees(data.assignees)
      setFormValues(values => ({ ...values, assignedTo: values.assignedTo === name ? '' : values.assignedTo }))
      if (editingAssignee === name) {
        setEditingAssignee(null)
        setAssigneeName('')
      }
      setAssigneeError('')
    } catch (error) {
      setAssigneeError(error.message)
    }
  }

  function setArchived(archived) {
    if (!editingDebt) return
    if (archived && !isDebtPaidOff(editingDebt)) return
    if (archived && !window.confirm(`Archive ${editingDebt.name}? Its bill schedule and payment history will be preserved.`)) {
      return
    }
    const nextDebts = debts.map(debt =>
      debt.id === editingDebt.id ? { ...debt, archived } : debt
    )
    saveDebts(nextDebts)
    setDebts(nextDebts)
    setIsFormOpen(false)
  }

  function removeDebt() {
    if (!editingDebt) return
    const links = getDebtDeletionLinks(editingDebt, accountData?.transactions ?? [])
    const warnings = []
    if (links.payments) warnings.push(`${links.payments} recorded ${links.payments === 1 ? 'payment' : 'payments'} in this debt's history will be deleted with it.`)
    if (links.transactions) warnings.push(`${links.transactions} linked account ${links.transactions === 1 ? 'transaction' : 'transactions'} will be kept in Accounts but no longer linked to a debt.`)
    const message = ['Are you sure you want to delete this debt?', ...warnings].join('\n\n')
    if (!window.confirm(message)) return
    try {
      setDebts(deleteDebt(editingDebt.id))
      setIsFormOpen(false)
      setEditingDebtId(null)
    } catch (error) {
      setFormError(error.message)
    }
  }

  function detailValue(label, value) {
    return (
      <div>
        <div style={{ color: '#9B7955', fontSize: 10 }}>{label}</div>
        <strong style={{ display: 'block', marginTop: 2, color: '#493320', fontSize: 13 }}>{value}</strong>
      </div>
    )
  }

  const linkedTransactions = accountData?.transactions ?? []

  const control = {
    border: '1px solid #E9D6B7',
    borderRadius: 10,
    padding: '9px 12px',
    color: '#79502A',
    background: '#FFFFFF',
    cursor: 'pointer'
  }

  function renderDebtCard(debt) {
    const scheduleStatus = scheduleStatusByDebt.get(debt.id)
    const dueLabel = scheduleStatus.isDueToday ? 'Due Today' : `Due ${displayDate(scheduleStatus.nextDueDate)}`
    return (
      <button
        type="button"
        key={debt.id}
        aria-label={`Debt row: ${debt.name}`}
        onClick={() => setSelectedDebtId(debt.id)}
        style={{
          display: 'block', width: '100%', minWidth: 0, margin: 0, padding: '8px 10px 7px',
          border: '1px solid #E9D6B7', borderRadius: 13,
          background: debt.archived ? '#F7F1E9' : '#FFFFFF',
          color: '#493320', textAlign: 'left', cursor: 'pointer', boxShadow: '0 1px 5px #7655220C'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', minWidth: 0 }}>
          <span style={{ display: 'block', minWidth: 0 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: 1.25 }}>
              {debt.name}{debt.archived ? ' · Archived' : ''}
            </strong>
            <span style={{ display: 'block', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9B7955', fontSize: 10, lineHeight: 1.3 }}>
              {debt.type} · {dueLabel}
              {debt.accountLast4 ? ` · ••${debt.accountLast4}` : ''}
              {getDebtAssignee(debt) ? ` · ${getDebtAssignee(debt)}` : ''}
              {getDebtInstallmentProgress(debt) ? ` · ${getDebtInstallmentProgress(debt).completed}/${getDebtInstallmentProgress(debt).total} installments` : ''}
            </span>
            {scheduleStatus.isPastDue && (
              <span style={{ display: 'block', marginTop: 2, color: '#B5473C', fontSize: 10, fontWeight: 700, lineHeight: 1.2 }}>
                Past Due since {displayDate(scheduleStatus.oldestOverdueDate)} · {money(scheduleStatus.overdueAmount)} overdue
              </span>
            )}
          </span>
          <span style={{ flexShrink: 0, textAlign: 'right' }}>
            <span style={{ display: 'block', color: '#9B7955', fontSize: 9, lineHeight: 1.15 }}>Balance owing</span>
            <strong style={{ color: '#79502A', fontSize: 14, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}>{money(debt.currentBalance)}</strong>
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 6, color: '#79502A', fontSize: 10, lineHeight: 1.2 }}>
          <span>{debt.paymentSchedule?.kind === 'pay-in-4'
            ? `Next payment ${scheduleStatus.nextPaymentAmount == null ? '—' : money(scheduleStatus.nextPaymentAmount)}`
            : `Min. payment ${debt.minimumPayment == null ? '—' : money(debt.minimumPayment)}`}</span>
          <strong>{getDebtRemainingPercent(debt).toFixed(0)}% left to pay</strong>
        </div>
        <div
          role="progressbar"
          aria-label={`${debt.name} paid off`}
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(getDebtProgress(debt))}
          title={`${getDebtProgress(debt).toFixed(0)}% paid off`}
          style={{ height: 4, marginTop: 5, overflow: 'hidden', borderRadius: 99, background: '#F1E6D7' }}
        >
          <div style={{ width: `${getDebtProgress(debt)}%`, height: '100%', borderRadius: 99, background: '#6E9A72' }} />
        </div>
      </button>
    )
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: ['menu', 'plan-choice'].includes(addMode) ? 196 : 84 }}>
      <ResponsiveText style={{
        margin: '0 0 14px',
        color: '#B87522',
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        textAlign: 'center'
      }}>Debt</ResponsiveText>

      <section aria-label="Overall debt progress" style={{
        marginBottom: 10,
        padding: '12px 14px',
        borderRadius: 14,
        background: '#F5D6A5',
        color: '#79502A'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: 0.35 }}>TOTAL DEBT REMAINING</div>
            <strong style={{ display: 'block', marginTop: 2, fontSize: 21, lineHeight: 1.15 }}>{money(debtSummary.totalRemaining)}</strong>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: 0.35 }}>TOTAL PAID OFF</div>
            <strong style={{ display: 'block', marginTop: 2, fontSize: 17, lineHeight: 1.15, color: '#493320' }}>{money(debtSummary.totalPaidOff)}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, fontWeight: 'bold' }}>
          <span>Overall progress</span>
          <span>{debtSummary.progressPercent}% paid off</span>
        </div>

        <div
          role="progressbar"
          aria-label="Overall debt progress"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={debtSummary.progressPercent}
          title={`${debtSummary.progressPercent}% paid off`}
          style={{ height: 6, marginTop: 5, overflow: 'hidden', borderRadius: 99, background: 'var(--theme-border, #E8CA97)' }}
        >
          <div style={{
            width: `${debtSummary.progressPercent}%`,
            height: '100%',
            borderRadius: 99,
            background: '#6E9A72',
            transition: 'width 0.2s ease'
          }} />
        </div>
      </section>

      <section style={{ display: 'grid', gap: 7 }}>
        {activeDebts.map(renderDebtCard)}
        {!visibleDebts.length && (
          <p style={{ margin: 4, color: '#79502A', fontSize: 13 }}>
            {showArchived ? 'No debts to show.' : 'Add a debt to track its balance.'}
          </p>
        )}
      </section>

      {debts.some(debt => debt.archived) && (
        <button
          type="button"
          aria-label="Show Archived Debts"
          onClick={() => setShowArchived(value => !value)}
          style={{ ...control, marginTop: 10, fontSize: 11 }}
        >{showArchived ? 'Hide Archived' : 'Show Archived'}</button>
      )}

      {paidOffDebts.length > 0 && (
        <section className="debt-paid-off" aria-label="Paid Off debts">
          <button type="button" className="debt-paid-off-toggle" aria-label={`Paid Off ${paidOffDebts.length}`} aria-expanded={showPaidOff}
            aria-controls="debt-paid-off-list" onClick={() => setShowPaidOff(value => !value)}>
            <span>Paid Off <span className="debt-paid-off-count">{paidOffDebts.length}</span></span>
            <span aria-hidden="true" className={showPaidOff ? 'debt-paid-off-chevron is-open' : 'debt-paid-off-chevron'}>›</span>
          </button>
          <div id="debt-paid-off-list" className="debt-paid-off-list">
            {showPaidOff && paidOffDebts.map(renderDebtCard)}
          </div>
        </section>
      )}

      <div ref={addMenuRef} className="debt-fab">
        <button
          type="button"
          className="debt-fab-toggle theme-primary-action theme-add-button theme-floating-add"
          aria-label={['menu', 'plan-choice'].includes(addMode) ? 'Close add debt menu' : 'Add debt'}
          aria-expanded={['menu', 'plan-choice'].includes(addMode)}
          aria-controls={['menu', 'plan-choice'].includes(addMode) ? 'debt-add-actions' : undefined}
          onClick={() => {
            setSelectedDebtId(null)
            setAddMode(mode => ['menu', 'plan-choice'].includes(mode) ? null : 'menu')
          }}
        >
          <svg aria-hidden="true" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        {['menu', 'plan-choice'].includes(addMode) && <div id="debt-add-actions" role="group" aria-label={addMode === 'plan-choice' ? 'Add payment plan actions' : 'Add debt actions'} className="debt-fab-actions">
          {addMode === 'plan-choice' ? <>
            <button type="button" className="debt-fab-action" onClick={openNewPaymentPlan}>
              <span className="debt-fab-label">Enter Manually</span>
            </button>
            <button type="button" className="debt-fab-action" onClick={() => {
              setEditingDebtId(null)
              setPaymentMethodWasSelected(false)
              setAddMode('plan-scan')
            }}><span className="debt-fab-label">Scan / Upload Payment Plan</span></button>
            <button type="button" className="debt-fab-action" onClick={() => setAddMode('menu')}><span className="debt-fab-label">Back</span></button>
          </> : <>
          <button type="button" className="debt-fab-action" onClick={openNewDebt}>
            <span className="debt-fab-label">Add Manually</span>
            <span className="debt-fab-circle">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5" />
              </svg>
            </span>
          </button>
          <button type="button" className="debt-fab-action" onClick={() => {
            setEditingDebtId(null)
            setPaymentMethodWasSelected(false)
            setAddMode('scan')
          }}>
            <span className="debt-fab-label">Scan / Upload</span>
            <span className="debt-fab-circle">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
                <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11H3V8a1 1 0 0 1 1-1Z" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            </span>
          </button>
          <button type="button" aria-label="Add Payment Plan" className="debt-fab-action" onClick={() => setAddMode('plan-choice')}>
            <span className="debt-fab-label">Add Payment Plan</span>
            <span className="debt-fab-circle" aria-hidden="true">≡</span>
          </button>
          </>}
        </div>}
      </div>

      {selectedDebt && (
        <div style={overlay} onMouseDown={event => {
          if (event.target === event.currentTarget) setSelectedDebtId(null)
        }}>
          <section role="dialog" aria-modal="true" aria-label={`${selectedDebt.name} debt details`} style={detailsDialog}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, overflow: 'hidden', color: '#79502A', fontSize: 18, lineHeight: 1.2, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedDebt.name}
                </h2>
                <div style={{ marginTop: 2, color: '#9B7955', fontSize: 11 }}>{selectedDebt.type}</div>
              </div>
              <button type="button" aria-label="Close debt details" onClick={() => setSelectedDebtId(null)} style={{
                flexShrink: 0,
                width: 30,
                height: 30,
                padding: 0,
                border: 'none',
                borderRadius: '50%',
                background: '#F5E9D7',
                color: '#79502A',
                fontSize: 20,
                lineHeight: 1,
                cursor: 'pointer'
              }}>×</button>
            </div>
            <div style={{
              padding: '9px 11px',
              borderRadius: 12,
              background: '#F5D6A5',
              color: '#79502A'
            }}>
              <div style={{ fontSize: 10, fontWeight: 600 }}>Outstanding Balance</div>
              <strong style={{ display: 'block', marginTop: 1, fontSize: 22, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
                {money(selectedDebt.currentBalance)}
              </strong>
            </div>
            <div style={{ ...detailGrid, marginTop: 11 }}>
              {detailValue('Minimum Payment', selectedDebt.minimumPayment == null ? '—' : money(selectedDebt.minimumPayment))}
              {selectedDebt.paymentSchedule?.kind === 'pay-in-4' && detailValue('Next Scheduled Payment', selectedScheduleStatus.nextPaymentAmount == null ? '—' : money(selectedScheduleStatus.nextPaymentAmount))}
              {detailValue('Next Payment Due', selectedDueLabel)}
              {detailValue('Starting Balance', money(selectedDebt.startingBalance))}
              {detailValue('APR %', selectedDebt.interestRate == null ? '—' : `${selectedDebt.interestRate}%`)}
              {selectedDebt.type === 'Credit Card' && (
                <>
                  {detailValue('Credit Limit', selectedDebt.creditLimit == null ? '—' : money(selectedDebt.creditLimit))}
                  {detailValue('Available Credit', getAvailableCredit(selectedDebt) == null ? '—' : money(getAvailableCredit(selectedDebt)))}
                </>
              )}
              {selectedDebt.accountLast4 && detailValue('Account Last 4 Digits', `••${selectedDebt.accountLast4}`)}
              {getDebtInstallmentProgress(selectedDebt) && detailValue('Installments', `${getDebtInstallmentProgress(selectedDebt).completed} of ${getDebtInstallmentProgress(selectedDebt).total} paid`)}
              {selectedDebt.purchaseCategory && detailValue('Purchase Category', selectedDebt.purchaseCategory)}
              {getDebtAssignee(selectedDebt) && detailValue('Assigned To', getDebtAssignee(selectedDebt))}
            </div>
            {selectedScheduleStatus.isPastDue && (
              <div role="status" style={{ marginTop: 8, color: '#B5473C', fontSize: 11, fontWeight: 700 }}>
                Past Due since {displayDate(selectedScheduleStatus.oldestOverdueDate)} · {money(selectedScheduleStatus.overdueAmount)} overdue
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#79502A', fontSize: 11 }}>
                <strong>Payoff Progress</strong>
                <span>{getDebtProgress(selectedDebt).toFixed(0)}% of balance paid off</span>
              </div>
              <div
                role="progressbar"
                aria-label={`${selectedDebt.name} payoff progress`}
                aria-valuemin="0"
                aria-valuemax="100"
                aria-valuenow={Math.round(getDebtProgress(selectedDebt))}
                style={{ height: 4, marginTop: 5, overflow: 'hidden', borderRadius: 99, background: '#F1E6D7' }}
              >
                <div style={{
                  width: `${getDebtProgress(selectedDebt)}%`,
                  height: '100%',
                  borderRadius: 99,
                  background: '#6E9A72'
                }} />
              </div>
            </div>
            {selectedHasInstallments && <details className="debt-future-payments" key={selectedDebt.id}>
              <summary>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m9 5 7 7-7 7" />
                </svg>
                Future Payments
                <span>{selectedFutureInstallments.length} upcoming</span>
              </summary>
              {selectedFutureInstallments.length ? <ul aria-label="Future payments">
                {selectedFutureInstallments.map(row => <li key={row.installmentNumber}>
                  <time dateTime={row.dueDate}>{displayDate(row.dueDate)}</time>
                  <strong>{money(row.amount)}</strong>
                </li>)}
              </ul> : <p>No upcoming installments.</p>}
            </details>}
            {selectedPendingInstallments.length > 0 && <section aria-label="Pending payments" style={{ flexShrink: 0 }}>
              <h3 style={{ margin: '12px 0 5px', color: '#79502A', fontSize: 13 }}>Pending Payments</h3>
              <div style={{ maxHeight: 'min(16dvh, 110px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
                {selectedPendingInstallments.map(row => <p key={row.installmentNumber} style={{ margin: '6px 0', fontSize: 12 }}>
                  {displayDate(row.dueDate)} · {money(row.amount)} · Pending on statement (not completed)
                </p>)}
              </div>
            </section>}
            <h3 style={{ margin: '12px 0 5px', color: '#79502A', fontSize: 13 }}>Payment History</h3>
            <div aria-label="Payment History" style={{ minHeight: 0, maxHeight: 'min(30dvh, 220px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {selectedPaymentHistory.length ? selectedPaymentHistory.map(payment => {
                const statementPaid = payment.source === 'statement'
                const skip = payment.source === 'skip'
                const transaction = linkedTransactions.find(item => item.id === payment.transactionId)
                const status = statementPaid ? 'Paid on statement'
                  : skip ? payment.skipped ? 'Skipped' : 'Restored'
                  : payment.reversedAt
                  ? 'Reversed'
                  : transaction?.cleared
                    ? 'Cleared'
                    : transaction
                      ? 'Uncleared'
                      : 'Transaction unavailable'
                const paymentStatus = !statementPaid && !skip && debtPaymentNeedsBalanceReview(selectedDebt, payment)
                  ? `${status} · Review balance`
                  : status
                return (
                  <div key={`${payment.source}:${payment.id}`} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderTop: '1px solid #F1E6D7',
                    fontSize: 12
                  }}>
                    <div>
                      <strong>{skip ? payment.skipped ? 'Skipped' : 'Skip undone'
                        : statementPaid || !payment.date ? `Scheduled ${displayDate(payment.scheduledDueDate)}`
                        : `Paid ${displayDate(payment.date)}`}</strong>
                      {!statementPaid && <div style={{ marginTop: 1, color: '#9B7955', fontSize: 10 }}>
                        {skip ? `Scheduled ${displayDate(payment.scheduledDueDate)}`
                          : payment.billOccurrenceId ? 'Money Honey · Bills / Accounts' : 'Money Honey · Accounts'}
                      </div>}
                    </div>
                    <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{money(payment.total)}</strong>
                    <span style={{
                      minWidth: 54,
                      textAlign: 'right',
                      color: transaction?.cleared && !payment.reversedAt ? '#478358' : '#9B7955',
                      fontSize: 10
                    }}>{paymentStatus}</span>
                  </div>
                )
              }) : (
                <p style={{ margin: '3px 0 0', color: '#9B7955', fontSize: 12 }}>No payments recorded.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => openEditDebt(selectedDebt)}
              style={{ ...control, flexShrink: 0, width: '100%', marginTop: 12, minHeight: 42, background: '#B87522', color: '#FFFFFF', border: 'none', fontWeight: 'bold' }}
            >Edit Debt</button>
          </section>
        </div>
      )}

      {['scan', 'plan-scan'].includes(addMode) && (
        <div className="statement-scan-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setAddMode(null) }}>
          <section ref={statementDialogRef} role="dialog" aria-modal="true" aria-labelledby="statement-scan-title" aria-describedby="statement-scan-description" className="statement-scan-dialog">
            <h2 id="statement-scan-title" className="statement-scan-title">
              <svg aria-hidden="true" focusable="false" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 12h10M12 7v10" /></svg>
              {addMode === 'plan-scan' ? 'Scan Payment Plan' : 'Scan Statement'}
            </h2>
            <StatementAutofill
              initialOpen currentValues={{}} fieldStyle={inputStyle} buttonStyle={control} extract={statementExtractor}
              mode={addMode === 'plan-scan' ? 'payment plan' : 'debt'}
              onManual={addMode === 'plan-scan' ? openNewPaymentPlan : openNewDebt} onClose={() => { setAddMode(null); addMenuRef.current?.querySelector('button')?.focus() }}
              onExtract={result => {
                const draft = applyStatement(result.values, { ...blankDebt(), type: '' }, result)
                const paymentPlan = addMode === 'plan-scan' || draft.paymentSchedule?.kind === 'payment-plan'
                setIsNewPaymentPlan(paymentPlan)
                setPreservePlanRows(paymentPlan)
                const total = Number(result.values.totalInstallments)
                const completed = Number(result.values.completedInstallments || 0)
                setPlanTerms(result.planTerms ?? { count: total > completed ? String(total - completed) : '', firstDate: result.values.nextPaymentDue || '', frequency: '' })
                if (paymentPlan) {
                  draft.type ||= 'Other'
                  draft.name ||= draft.merchant || ''
                  draft.paymentCalculationMethod = DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
                  if (draft.statementDetails?.purchaseAmount != null && !String(draft.startingBalance ?? '').trim()) {
                    draft.startingBalance = String(draft.statementDetails.purchaseAmount)
                  }
                  draft.paymentSchedule = draft.paymentSchedule?.kind === 'payment-plan' ? draft.paymentSchedule : { kind: 'payment-plan', frequency: 'explicit', installments: [] }
                }
                setFormValues(draft)
                setStatementReview(result)
                setSelectedDebtId(null)
                setEditingDebtId(null)
                setFormError('')
                setAddMode(null)
                setIsFormOpen(true)
              }}
            />
          </section>
        </div>
      )}

      {isAssigneeManagerOpen && (
        <div style={overlay} onMouseDown={event => {
          if (event.target === event.currentTarget) setIsAssigneeManagerOpen(false)
        }}>
          <section role="dialog" aria-modal="true" aria-label="Manage Assignees" style={dialog}>
            <h2 style={{ margin: '0 0 8px', color: '#79502A', fontSize: 18 }}>Manage Assignees</h2>
            <p style={{ margin: '0 0 10px', color: '#9B7955', fontSize: 11 }}>
              Changes save immediately. Renaming updates assigned debts, including archived debts.
            </p>
            <form onSubmit={saveAssignee} style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
              <label style={formLabel}>{editingAssignee === null ? 'New Assignee' : 'Rename Assignee'}
                <input aria-label={editingAssignee === null ? 'New assignee name' : 'Assignee name'} value={assigneeName} onChange={event => setAssigneeName(event.target.value)} style={inputStyle} required />
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="submit" className="theme-primary-action" style={control}>{editingAssignee === null ? 'Add Assignee' : 'Save Assignee'}</button>
                {editingAssignee !== null && (
                  <button type="button" onClick={() => { setEditingAssignee(null); setAssigneeName(''); setAssigneeError('') }} style={control}>Cancel Rename</button>
                )}
              </div>
            </form>
            {assigneeError && <p role="alert" style={{ color: '#B5473C', fontSize: 12 }}>{assigneeError}</p>}
            <div style={{ display: 'grid', gap: 6 }}>
              {assignees.map(name => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderTop: '1px solid #E9D6B7' }}>
                  <strong style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: '#79502A', fontSize: 12 }}>{name}</strong>
                  <button type="button" aria-label={`Rename assignee ${name}`} onClick={() => { setEditingAssignee(name); setAssigneeName(name); setAssigneeError('') }} style={{ ...control, padding: '6px 8px', fontSize: 11 }}>Rename</button>
                  <button type="button" aria-label={`Delete assignee ${name}`} onClick={() => removeAssignee(name)} style={{ ...control, padding: '6px 8px', fontSize: 11 }}>Delete</button>
                </div>
              ))}
              {assignees.length === 0 && <p style={{ color: '#9B7955', fontSize: 12 }}>No assignees. Debts can remain Unassigned.</p>}
            </div>
            <button type="button" onClick={() => setIsAssigneeManagerOpen(false)} style={{ ...control, width: '100%', marginTop: 12 }}>Done</button>
          </section>
        </div>
      )}

      {isFormOpen && !isAssigneeManagerOpen && (
        <div style={overlay} onMouseDown={event => {
          if (event.target === event.currentTarget) setIsFormOpen(false)
        }}>
          <section role="dialog" aria-modal="true" aria-label={editingDebtId === null ? isNewPaymentPlan ? 'Add payment plan form' : 'Add debt form' : 'Edit debt form'} style={dialog}>
            <h2 style={{ margin: '0 0 12px', color: '#79502A' }}>{editingDebtId === null ? isNewPaymentPlan ? 'Add Payment Plan' : 'Add Debt' : 'Edit Debt'}</h2>
            <form onSubmit={saveDebt} style={{ display: 'grid', gap: 10 }}>
              {statementReview && <p role="status" style={{ margin: 0, fontSize: 11, color: '#79502A' }}>
                {isNewPaymentPlan && statementReview.installments?.length
                  ? 'Schedule found from statement. Review before saving.'
                  : 'Statement scanned. Review your information before saving.'}
              </p>}
              {(statementReview?.warnings ?? []).filter(warning =>
                !(isNewPaymentPlan && statementReview.installments?.length && warning === 'Schedule found from statement. Review before saving.')
                && !(isNewPaymentPlan && warning === 'Some scanned dates have no year. Confirm each scanned month and day and enter its full date.'
                  && formValues.paymentSchedule?.installments?.every(row => row.dueDate || !row.scannedDate))
              ).map(warning => <p key={warning} role="status" style={{ margin: 0, fontSize: 11 }}>{warning}</p>)}
              {isNewPaymentPlan && <>
                <label style={formLabel}>Plan Name
                  <input aria-label="Debt name" value={formValues.name} onChange={event => setFormValues({ ...formValues, name: event.target.value })} style={inputStyle} required />
                </label>
                <label style={formLabel}>Provider (optional)
                  <input aria-label="Plan provider" value={formValues.provider ?? ''} onChange={event => setFormValues({ ...formValues, provider: event.target.value })} style={inputStyle} />
                </label>
                {[
                  ['purchaseAmount', 'Purchase amount'],
                  ['totalInterest', 'Total interest'],
                  ['totalRepayment', 'Total repayment']
                ].map(([key, label]) => <label key={key} style={formLabel}>{label} (optional)
                  <FinancialInput aria-label={label} value={formValues.statementDetails?.[key] ?? ''} style={inputStyle}
                    onChange={event => setFormValues({ ...formValues, statementDetails: { ...formValues.statementDetails, [key]: event.target.value } })} />
                </label>)}
                <label style={formLabel}>APR (optional)
                  <FinancialInput aria-label="Plan APR" value={formValues.interestRate} style={inputStyle}
                    onChange={event => setFormValues({ ...formValues, interestRate: event.target.value })} />
                </label>
                <label style={formLabel}>Purchase Category (optional)
                  <select aria-label="Purchase Category" value={formValues.purchaseCategory ?? ''} style={inputStyle}
                    onChange={event => setFormValues({ ...formValues, purchaseCategory: event.target.value })}>
                    <option value="">No category</option>
                    {expenseCategories.map(category => <option key={category}>{category}</option>)}
                    {formValues.purchaseCategory && !expenseCategories.includes(formValues.purchaseCategory) && <option>{formValues.purchaseCategory}</option>}
                  </select>
                </label>
                <label style={formLabel}>Remaining Balance
                  <FinancialInput aria-label="Current balance · amount still owed" value={formValues.currentBalance} style={inputStyle} required
                    onChange={event => setFormValues({ ...formValues, currentBalance: event.target.value })} />
                </label>
              </>}
              {!isNewPaymentPlan && <>
              {(editingDebt || formSchedule?.kind === 'payment-plan') && <StatementAutofill
                currentValues={formValues}
                fieldStyle={inputStyle}
                buttonStyle={control}
                extract={statementExtractor}
                onApply={(values, result) => {
                  if (isNewPaymentPlan && result.installments?.length) setPreservePlanRows(true)
                  setFormError(result.installments?.length && (formValues.paymentHistory.length || editingDebtBill?.paymentHistory?.length)
                    ? 'Scanned details applied. The installment rows were not replaced because this debt has payment history.' : '')
                  setFormValues(current => applyStatement(values, current, result))
                }}
              />}
              <label style={formLabel}>{isNewPaymentPlan ? 'Plan Name' : 'Debt Name'}
                <input aria-label="Debt name" placeholder="e.g. Auto loan" value={formValues.name} onChange={event => setFormValues({ ...formValues, name: event.target.value })} style={inputStyle} required />
              </label>
              <label style={formLabel}>Purchase Category (optional)
                <select aria-label="Purchase Category" value={formValues.purchaseCategory ?? ''} style={inputStyle}
                  onChange={event => setFormValues({ ...formValues, purchaseCategory: event.target.value })}>
                  <option value="">Choose category</option>
                  {expenseCategories.map(category => <option key={category}>{category}</option>)}
                  {formValues.purchaseCategory && !expenseCategories.includes(formValues.purchaseCategory) && <option>{formValues.purchaseCategory}</option>}
                </select>
              </label>
              <p style={{ margin: 0, fontSize: 11 }}>Category describes the purchase only. Record the original purchase once in Accounts for spending reports. Debt repayments are excluded from spending; scanning never creates a purchase transaction.</p>
              {isPlanForm && <details open={isNewPaymentPlan} style={{ fontSize: 12 }}>
                <summary>Purchase details (optional)</summary>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 6 }}>
                  {[['provider', 'Provider'], ['merchant', 'Merchant']].map(([key, label]) => <label key={key} style={formLabel}>{label}
                    <input aria-label={label} value={formValues[key] ?? ''} style={inputStyle}
                      onChange={event => setFormValues({ ...formValues, [key]: event.target.value })} />
                  </label>)}
                </div>
              </details>}
              {!isNewPaymentPlan && <label style={formLabel}>Debt Type
                <select aria-label="Debt type" value={formValues.type} onChange={event => setFormValues({ ...formValues, type: event.target.value })} style={inputStyle} required>
                  {!formValues.type && <option value="">Choose debt type</option>}
                  {getDebtTypes().map(type => <option key={type}>{type}</option>)}
                </select>
              </label>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                <label style={formLabel}>Account Last 4 Digits
                  <input aria-label="Account Last 4 Digits" type="text" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="off" placeholder="Optional" value={formValues.accountLast4} onChange={event => setFormValues({ ...formValues, accountLast4: event.target.value })} style={inputStyle} />
                </label>
                <div style={{ display: 'grid', gap: 2 }}>
                  <label style={formLabel}>Assigned To
                    <select aria-label="Assigned To" value={formValues.assignedTo} onChange={event => setFormValues({ ...formValues, assignedTo: event.target.value })} style={inputStyle}>
                      <option value="">Unassigned</option>
                      {assignees.map(assignee => <option key={assignee}>{assignee}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={openAssigneeManager} style={{ ...control, justifySelf: 'start', padding: '2px 0', border: 'none', background: 'transparent', fontSize: 11 }}>Manage Assignees</button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {[
                  ...(formValues.type === 'Credit Card'
                    ? [['Credit Limit', 'creditLimit', 'Credit Limit']]
                    : !formValues.type || formSchedule?.kind === 'pay-in-4' ? [] : [['Starting Balance', 'startingBalance', 'Starting balance · original amount borrowed or owed']]),
                  ['Current Balance', 'currentBalance', 'Current balance · amount still owed']
                ].map(([label, key, ariaLabel]) => (
                  <label key={key} style={formLabel}>{label}
                    <FinancialInput
                      aria-label={ariaLabel}
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder="$0.00"
                      value={formValues[key]}
                      onChange={event => setFormValues({
                        ...formValues, [key]: event.target.value,
                        ...(key === 'currentBalance' && formSchedule?.kind === 'pay-in-4'
                          && formSchedule.frequency === 'biweekly' && formSchedule.completedInstallments === 0
                          && formSchedule.installmentAmount == null && !formValues.paymentHistory.length
                          && !editingDebtBill?.paymentHistory?.length
                          ? { paymentSchedule: { ...formSchedule, remainingTotal: event.target.value } } : {})
                      })}
                      style={inputStyle}
                      required={key !== 'creditLimit'}
                    />
                  </label>
                ))}
              </div>
              {formValues.type === 'Credit Card' && (
                <p style={{ margin: 0, color: '#9B7955', fontSize: 11 }}>
                  {creditPreview && <>{creditPreview} </>}
                  {editingDebt
                    ? `Historical starting balance ${money(editingDebt.startingBalance)} is preserved for payoff tracking.`
                    : 'Payoff tracking starts with the current balance, not the credit limit.'}
                </p>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {[
                  ['APR %', 'interestRate', 'Interest rate · annual percentage (optional)', '%'],
                  ['Min. Payment', 'minimumPayment', 'Minimum payment · amount due each cycle (optional)', '$0.00']
                ].map(([label, key, ariaLabel, placeholder]) => (
                  <label key={key} style={formLabel}>{label}
                    <FinancialInput
                      aria-label={ariaLabel}
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      placeholder={placeholder}
                      value={formValues[key]}
                      onChange={event => {
                        const value = event.target.value
                        let method
                        if (key === 'interestRate' && !paymentMethodWasSelected) {
                          try {
                            method = parseFinancialAmount(value, 'APR', { optional: true }) > 0
                              ? DEBT_PAYMENT_CALCULATION_METHODS.MANUAL_PRINCIPAL : DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
                          } catch { method = formValues.paymentCalculationMethod }
                        }
                        setFormValues({
                          ...formValues,
                          [key]: value,
                          ...(method ? { paymentCalculationMethod: method } : {})
                        })
                      }}
                      style={inputStyle}
                    />
                  </label>
                ))}
              </div>
              </>}
              {editingDebt && <label style={formLabel}>Payment setup
                <select aria-label="Payment setup" value={formSchedule?.kind === 'payment-plan' ? 'plan' : 'regular'} style={inputStyle}
                  disabled={Boolean(editingDebt?.paymentHistory.length || editingDebtBill?.paymentHistory?.length)}
                  onChange={event => setFormValues({ ...formValues, paymentSchedule: event.target.value === 'plan'
                    ? { kind: 'payment-plan', frequency: 'explicit', installments: [{ dueDate: '', amount: '', paid: false, installmentNumber: 1 }] }
                    : defaultSchedule(formValues.nextPaymentDue) })}>
                  <option value="regular">Regular debt</option>
                  <option value="plan">Payment Plan</option>
                </select>
              </label>}
              {isNewPaymentPlan && <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                  <label style={formLabel}>Number of payments
                    <input aria-label="Number of payments" type="number" min="1" max="600" value={planTerms.count} style={inputStyle}
                      onChange={event => setPlanTerms({ ...planTerms, count: event.target.value })} />
                  </label>
                  <label style={formLabel}>First payment date
                    <input aria-label="First payment date" type="date" value={planTerms.firstDate} style={inputStyle}
                      onChange={event => {
                        const firstDate = event.target.value
                        setPlanTerms({ ...planTerms, firstDate })
                        if (isNewPaymentPlan && preservePlanRows && planTerms.frequency === 'monthly') {
                          const rows = resolveScannedMonthlyDates(formValues.paymentSchedule?.installments ?? [], firstDate)
                          if (rows) changeNewPlanRows(rows)
                        }
                      }} />
                  </label>
                </div>
                {preservePlanRows && formValues.paymentSchedule?.installments?.some(row => !row.dueDate && row.scannedDate)
                  && <p style={{ margin: 0, fontSize: 11 }}>Confirm the first payment date and year to fill a matching monthly timeline. Review all scanned dates.</p>}
                <label style={formLabel}>Frequency
                  <select aria-label="Generated schedule frequency" value={planTerms.frequency} style={inputStyle}
                    onChange={event => setPlanTerms({ ...planTerms, frequency: event.target.value })}>
                    <option value="">Choose frequency</option>
                    {PAYMENT_FREQUENCY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <PaymentPlanFields rows={formSchedule?.installments ?? []} onChange={changeNewPlanRows}
                  fieldStyle={inputStyle} labelStyle={formLabel} balance={formValues.currentBalance} allowGenerate={false} />
              </>}
              {!isNewPaymentPlan && (formSchedule?.kind === 'payment-plan' ? <PaymentPlanFields rows={formSchedule.installments}
                paymentHistory={formValues.paymentHistory} fieldStyle={inputStyle} labelStyle={formLabel}
                balance={formValues.currentBalance} hasBillHistory={Boolean(editingDebtBill?.paymentHistory?.length)}
                onChange={installments => setFormValues({ ...formValues, paymentSchedule: { ...formSchedule, installments } })} />
                : <DebtScheduleFields value={formSchedule} nextDate={formValues.nextPaymentDue}
                nextPayment={formScheduleStatus} error={schedulePreviewError}
                onChange={paymentSchedule => {
                  if (editingDebt?.paymentSchedule?.totalInstallments != null
                    && (editingDebt.paymentHistory.length || editingDebtBill?.paymentHistory?.length)) {
                    setFormError('This saved installment schedule has payment or skip history and is kept to protect its links. You can still edit the debt details and next payment due date.')
                    return
                  }
                  setFormError('')
                  setFormValues({ ...formValues, paymentSchedule })
                }}
                fieldStyle={inputStyle} labelStyle={formLabel} />)}
              {formSchedule?.kind !== 'payment-plan' && <label style={formLabel}>Next Payment Due
                <input
                  aria-label="Next Payment Due"
                  type="date"
                  value={formValues.nextPaymentDue}
                  onChange={event => {
                    let next
                    try {
                      if (editingDebt && formValues.paymentHistory.length && formSchedule) {
                        const paymentSchedule = scheduleFromForm(formSchedule, formValues.nextPaymentDue)
                        validatePaymentSchedule(paymentSchedule)
                        next = getDebtScheduleStatus({ ...formValues, paymentSchedule }, bills, accountData?.transactions ?? []).nextScheduledDate
                      }
                    } catch (error) { setFormError(error.message); return }
                    setFormValues({ ...formValues, nextPaymentDue: event.target.value,
                      ...(formValues.paymentSchedule ? { paymentSchedule: next && formValues.paymentHistory.length ? {
                        ...formValues.paymentSchedule,
                        dateAdjustments: [...(formValues.paymentSchedule.dateAdjustments ?? []).filter(item => item.scheduledDate !== next), { scheduledDate: next, dueDate: event.target.value }]
                      } : { ...formValues.paymentSchedule, startDate: event.target.value, dueDay: '' } } : {})
                    })
                  }}
                  style={inputStyle}
                />
              </label>}
              {!isNewPaymentPlan && <label style={formLabel}>Payment Balance Method
                <select
                  aria-label="Payment balance method"
                  value={formValues.paymentCalculationMethod}
                  onChange={event => {
                    setPaymentMethodWasSelected(true)
                    setFormValues({
                      ...formValues,
                      paymentCalculationMethod: event.target.value
                    })
                  }}
                  style={inputStyle}
                >
                  <option value={DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY}>
                    Principal-only · full payment reduces balance
                  </option>
                  <option value={DEBT_PAYMENT_CALCULATION_METHODS.MANUAL_PRINCIPAL}>
                    Manual principal · review balance
                  </option>
                </select>
              </label>}
              {formError && <p role="alert" style={{ margin: 0, color: '#9B463E', fontSize: 12 }}>{formError}</p>}
              <div style={{ position: 'sticky', bottom: -20, display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '4px -20px -20px', padding: '12px 20px max(12px, env(safe-area-inset-bottom))', background: '#FFF8ED', borderTop: '1px solid #E9D6B7' }}>
                  <button type="button" className="theme-secondary-action" onClick={() => setIsFormOpen(false)} style={control}>Cancel</button>
                  <button type="submit" className="theme-primary-action" style={{ ...control, minHeight: 42, border: 'none', background: '#B87522', color: '#FFFFFF', fontWeight: 'bold' }}>
                    {editingDebtId === null ? isNewPaymentPlan ? 'Add Payment Plan' : 'Add Debt' : 'Save Debt'}
                  </button>
              </div>
            </form>
            {editingDebt && (
              <details style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid #E9D6B7', color: '#9B7955', fontSize: 11 }}>
                <summary style={{ cursor: 'pointer' }}>Debt management</summary>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 9 }}>
                  {(editingDebt.archived || isDebtPaidOff(editingDebt)) && (
                    <button
                      type="button"
                      onClick={() => setArchived(!editingDebt.archived)}
                      style={{ ...control, minHeight: 38, color: editingDebt.archived ? '#79502A' : '#9B463E', fontSize: 11 }}
                    >{editingDebt.archived ? 'Restore Debt' : 'Archive Debt'}</button>
                  )}
                  <button
                    type="button"
                    onClick={removeDebt}
                    style={{ ...control, minHeight: 38, color: '#9B463E', fontSize: 11 }}
                  >Delete Debt</button>
                </div>
              </details>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
