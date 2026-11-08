import { useEffect, useState } from 'react'
import { loadSavedAccountData } from './accountStorage.js'
import { loadBillData } from './billData.js'
import {
  applyPrincipalOnlyToReviewPayments,
  DEBT_PAYMENT_CALCULATION_METHODS,
  createDebtId,
  debtPaymentNeedsBalanceReview,
  getDebtPaymentCalculationMethod,
  getMatchingDebtBill,
  getNextDebtPaymentDue,
  getDebtScheduleStatus,
  getDebtProgress,
  getDebtRemainingPercent,
  getDebtTypes,
  loadDebts,
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
  overflow: 'hidden',
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
    type: 'Credit Card',
    startingBalance: '',
    currentBalance: '',
    interestRate: '',
    minimumPayment: '',
    nextPaymentDue: '',
    paymentCalculationMethod: DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY,
    paymentHistory: []
  }
}

export default function Debt() {
  const [debts, setDebts] = useState(() => loadDebts())
  const [accountData, setAccountData] = useState(() => loadSavedAccountData())
  const [bills, setBills] = useState(() => loadBillData([]).bills)
  const [showArchived, setShowArchived] = useState(false)
  const [selectedDebtId, setSelectedDebtId] = useState(null)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingDebtId, setEditingDebtId] = useState(null)
  const [formValues, setFormValues] = useState(blankDebt)
  const [paymentMethodWasSelected, setPaymentMethodWasSelected] = useState(false)
  const [formError, setFormError] = useState('')
  const totalDebt = debts.reduce((sum, debt) => sum + debt.currentBalance, 0)
  const visibleDebts = debts.filter(debt => showArchived || !debt.archived)
  const editingDebt = debts.find(debt => debt.id === editingDebtId) ?? null
  const selectedDebt = debts.find(debt => debt.id === selectedDebtId) ?? null
  const selectedDebtBill = selectedDebt
    ? bills.find(bill => bill.id === selectedDebt.billId && bill.debtId === selectedDebt.id)
      ?? bills.find(bill => bill.debtId === selectedDebt.id)
    : null
  const selectedSkipHistory = (selectedDebtBill?.paymentHistory ?? [])
    .filter(entry => typeof entry.skipped === 'boolean')
    .slice()
    .reverse()
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
  const selectedDueLabel = selectedScheduleStatus?.isDueToday
    ? 'Due Today'
    : displayDate(selectedScheduleStatus?.nextDueDate)

  useEffect(() => {
    const refresh = () => setDebts(loadDebts())
    const refreshAccounts = () => setAccountData(loadSavedAccountData())
    const refreshBills = () => setBills(loadBillData([]).bills)
    window.addEventListener('money-honey-debts-updated', refresh)
    window.addEventListener('money-honey-bills-updated', refreshBills)
    window.addEventListener('money-honey-accounts-updated', refreshAccounts)
    window.addEventListener('storage', refresh)
    window.addEventListener('storage', refreshBills)
    synchronizeDebtBills()
    return () => {
      window.removeEventListener('money-honey-debts-updated', refresh)
      window.removeEventListener('money-honey-bills-updated', refreshBills)
      window.removeEventListener('money-honey-accounts-updated', refreshAccounts)
      window.removeEventListener('storage', refresh)
      window.removeEventListener('storage', refreshBills)
    }
  }, [])

  function openNewDebt() {
    setSelectedDebtId(null)
    setEditingDebtId(null)
    setFormValues(blankDebt())
    setPaymentMethodWasSelected(false)
    setFormError('')
    setIsFormOpen(true)
  }

  function openEditDebt(debt) {
    setSelectedDebtId(null)
    setEditingDebtId(debt.id)
    setFormValues({
      ...debt,
      startingBalance: String(debt.startingBalance),
      currentBalance: String(debt.currentBalance),
      interestRate: debt.interestRate == null ? '' : String(debt.interestRate),
      minimumPayment: debt.minimumPayment == null ? '' : String(debt.minimumPayment),
      nextPaymentDue: getNextDebtPaymentDue(debt),
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
    const numeric = value => value === '' ? null : Number(value)
    try {
      const debt = validateDebt({
        ...formValues,
        id: editingDebtId ?? createDebtId(debts),
        startingBalance: Number(formValues.startingBalance),
        currentBalance: Number(formValues.currentBalance),
        interestRate: numeric(formValues.interestRate),
        minimumPayment: numeric(formValues.minimumPayment),
        nextPaymentDue: formValues.nextPaymentDue || null
      })
      persistDebt(debt)
    } catch (error) {
      setFormError(error.message)
    }
  }

  function setArchived(archived) {
    if (!editingDebt) return
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

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 8 }}>
      <h1 style={{
        margin: '0 0 14px',
        color: '#B87522',
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        textAlign: 'center'
      }}>Debt 🍯</h1>

      <section aria-label="Total debt remaining" style={{
        marginBottom: 10,
        padding: '10px 14px',
        borderRadius: 14,
        background: '#F5D6A5',
        color: '#79502A'
      }}>
        <div style={{ fontSize: 10, fontWeight: 'bold', letterSpacing: 0.35 }}>TOTAL DEBT REMAINING</div>
        <strong style={{ display: 'block', marginTop: 2, fontSize: 21, lineHeight: 1.15 }}>{money(totalDebt)}</strong>
      </section>

      <section style={{
        display: 'grid',
        gap: 7
      }}>
        {visibleDebts.length ? visibleDebts.map(debt => {
            const scheduleStatus = scheduleStatusByDebt.get(debt.id)
            const dueLabel = scheduleStatus.isDueToday
              ? 'Due Today'
              : `Due ${displayDate(scheduleStatus.nextDueDate)}`
            return (
          <button
            type="button"
            key={debt.id}
            aria-label={`Debt row: ${debt.name}`}
            onClick={() => setSelectedDebtId(debt.id)}
            style={{
              display: 'block',
              width: '100%',
              minWidth: 0,
              margin: 0,
              padding: '8px 10px 7px',
              border: '1px solid #E9D6B7',
              borderRadius: 13,
              background: debt.archived ? '#F7F1E9' : '#FFFFFF',
              color: '#493320',
              textAlign: 'left',
              cursor: 'pointer',
              boxShadow: '0 1px 5px #7655220C'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', minWidth: 0 }}>
              <span style={{ display: 'block', minWidth: 0 }}>
                <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, lineHeight: 1.25 }}>
                  {debt.name}{debt.archived ? ' · Archived' : ''}
                </strong>
                <span style={{ display: 'block', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#9B7955', fontSize: 10, lineHeight: 1.3 }}>
                  {debt.type} · {dueLabel}
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
              <span>Min. payment {debt.minimumPayment == null ? '—' : money(debt.minimumPayment)}</span>
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
              <div style={{
                width: `${getDebtProgress(debt)}%`,
                height: '100%',
                borderRadius: 99,
                background: '#6E9A72'
              }} />
            </div>
          </button>
            )
        }) : (
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

      <button
        type="button"
        aria-label="Add debt"
        onClick={openNewDebt}
        style={{
          position: 'fixed',
          right: 'max(20px, calc((100vw - 460px) / 2))',
          bottom: 'calc(100px + env(safe-area-inset-bottom))',
          zIndex: 20,
          width: 58,
          height: 58,
          border: 'none',
          borderRadius: '50%',
          background: '#B87522',
          color: '#FFFFFF',
          boxShadow: '0 4px 14px #76552255',
          fontSize: 32,
          cursor: 'pointer'
        }}
      >+</button>

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
              {detailValue('Next Payment Due', selectedDueLabel)}
              {detailValue('Starting Balance', money(selectedDebt.startingBalance))}
              {detailValue('APR %', selectedDebt.interestRate == null ? '—' : `${selectedDebt.interestRate}%`)}
            </div>
            {selectedScheduleStatus.isPastDue && (
              <div role="status" style={{ marginTop: 8, color: '#B5473C', fontSize: 11, fontWeight: 700 }}>
                Past Due since {displayDate(selectedScheduleStatus.oldestOverdueDate)} · {money(selectedScheduleStatus.overdueAmount)} overdue
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: '#79502A', fontSize: 11 }}>
                <strong>Payoff Progress</strong>
                <span>{getDebtProgress(selectedDebt).toFixed(0)}% paid</span>
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
            <h3 style={{ margin: '12px 0 5px', color: '#79502A', fontSize: 13 }}>Payment History</h3>
            <div style={{ minHeight: 0, maxHeight: 'min(30dvh, 220px)', overflowY: 'auto', overscrollBehavior: 'contain' }}>
              {selectedDebt.paymentHistory.length || selectedSkipHistory.length ? (
                <>
              {[...selectedDebt.paymentHistory].reverse().map(payment => {
                const transaction = linkedTransactions.find(item => item.id === payment.transactionId)
                const status = payment.reversedAt
                  ? 'Reversed'
                  : transaction?.cleared
                    ? 'Cleared'
                    : transaction
                      ? 'Uncleared'
                      : 'Transaction unavailable'
                const paymentStatus = debtPaymentNeedsBalanceReview(selectedDebt, payment)
                  ? `${status} · Review balance`
                  : status
                return (
                  <div key={payment.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderTop: '1px solid #F1E6D7',
                    fontSize: 12
                  }}>
                    <strong>Paid {displayDate(payment.date)}</strong>
                    <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>{money(payment.total)}</strong>
                    <span style={{
                      minWidth: 54,
                      textAlign: 'right',
                      color: transaction?.cleared && !payment.reversedAt ? '#478358' : '#9B7955',
                      fontSize: 10
                    }}>{paymentStatus}</span>
                  </div>
                )
              })}
              {selectedSkipHistory.map((entry, index) => (
                <div key={`skip:${selectedDebtBill.id}:${entry.dueDate}:${entry.changedAt}:${index}`} style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  borderTop: '1px solid #F1E6D7',
                  fontSize: 12
                }}>
                  <div>
                    <strong>{entry.skipped ? 'Skipped' : 'Skip undone'}</strong>
                    <div style={{ marginTop: 1, color: '#9B7955', fontSize: 10 }}>
                      Scheduled {displayDate(entry.dueDate)}
                    </div>
                  </div>
                  <strong style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                    {money(selectedDebtBill.amount)}
                  </strong>
                  <span style={{ minWidth: 54, textAlign: 'right', color: '#9B7955', fontSize: 10 }}>
                    {entry.skipped ? 'Skipped' : 'Restored'}
                  </span>
                </div>
              ))}
                </>
              ) : (
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

      {isFormOpen && (
        <div style={overlay} onMouseDown={event => {
          if (event.target === event.currentTarget) setIsFormOpen(false)
        }}>
          <section role="dialog" aria-modal="true" aria-label={editingDebtId === null ? 'Add debt form' : 'Edit debt form'} style={dialog}>
            <h2 style={{ margin: '0 0 12px', color: '#79502A' }}>{editingDebtId === null ? 'Add Debt' : 'Edit Debt'}</h2>
            <form onSubmit={saveDebt} style={{ display: 'grid', gap: 10 }}>
              <label style={formLabel}>Debt Name
                <input aria-label="Debt name" placeholder="e.g. Auto loan" value={formValues.name} onChange={event => setFormValues({ ...formValues, name: event.target.value })} style={inputStyle} required />
              </label>
              <label style={formLabel}>Debt Type
                <select aria-label="Debt type" value={formValues.type} onChange={event => setFormValues({ ...formValues, type: event.target.value })} style={inputStyle}>
                  {getDebtTypes().map(type => <option key={type}>{type}</option>)}
                </select>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {[
                  ['Starting Balance', 'startingBalance', 'Starting balance · original amount borrowed or owed'],
                  ['Current Balance', 'currentBalance', 'Current balance · amount still owed']
                ].map(([label, key, ariaLabel]) => (
                  <label key={key} style={formLabel}>{label}
                    <input
                      aria-label={ariaLabel}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="$0.00"
                      value={formValues[key]}
                      onChange={event => setFormValues({ ...formValues, [key]: event.target.value })}
                      style={inputStyle}
                      required
                    />
                  </label>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
                {[
                  ['APR %', 'interestRate', 'Interest rate · annual percentage (optional)', '%'],
                  ['Min. Payment', 'minimumPayment', 'Minimum payment · amount due each cycle (optional)', '$0.00']
                ].map(([label, key, ariaLabel, placeholder]) => (
                  <label key={key} style={formLabel}>{label}
                    <input
                      aria-label={ariaLabel}
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={placeholder}
                      value={formValues[key]}
                      onChange={event => {
                        const value = event.target.value
                        setFormValues({
                          ...formValues,
                          [key]: value,
                          ...(key === 'interestRate' && !paymentMethodWasSelected ? {
                            paymentCalculationMethod: value !== '' && Number(value) > 0
                              ? DEBT_PAYMENT_CALCULATION_METHODS.MANUAL_PRINCIPAL
                              : DEBT_PAYMENT_CALCULATION_METHODS.PRINCIPAL_ONLY
                          } : {})
                        })
                      }}
                      style={inputStyle}
                    />
                  </label>
                ))}
              </div>
              <label style={formLabel}>Next Payment Due
                <input
                  aria-label="Next Payment Due"
                  type="date"
                  value={formValues.nextPaymentDue}
                  onChange={event => setFormValues({ ...formValues, nextPaymentDue: event.target.value })}
                  style={inputStyle}
                />
              </label>
              <label style={formLabel}>Payment Balance Method
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
              </label>
              {formError && <p role="alert" style={{ margin: 0, color: '#9B463E', fontSize: 12 }}>{formError}</p>}
              <div style={{ position: 'sticky', bottom: -20, display: 'flex', justifyContent: 'flex-end', gap: 8, margin: '4px -20px -20px', padding: '12px 20px max(12px, env(safe-area-inset-bottom))', background: '#FFF8ED', borderTop: '1px solid #E9D6B7' }}>
                  <button type="button" onClick={() => setIsFormOpen(false)} style={control}>Cancel</button>
                  <button type="submit" style={{ ...control, minHeight: 42, border: 'none', background: '#B87522', color: '#FFFFFF', fontWeight: 'bold' }}>
                    {editingDebtId === null ? 'Add Debt' : 'Save Debt'}
                  </button>
              </div>
            </form>
            {editingDebt && (
              <details style={{ marginTop: 16, paddingTop: 10, borderTop: '1px solid #E9D6B7', color: '#9B7955', fontSize: 11 }}>
                <summary style={{ cursor: 'pointer' }}>Debt management</summary>
                <button
                  type="button"
                  onClick={() => setArchived(!editingDebt.archived)}
                  style={{ ...control, minHeight: 38, marginTop: 9, color: editingDebt.archived ? '#79502A' : '#9B463E', fontSize: 11 }}
                >{editingDebt.archived ? 'Restore Debt' : 'Archive Debt'}</button>
              </details>
            )}
          </section>
        </div>
      )}
    </main>
  )
}
