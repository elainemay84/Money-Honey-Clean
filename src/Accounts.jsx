
import { useEffect, useRef, useState } from 'react'
import {
  calculateAccountBalances,
  getNextTransactionSequence,
  moveTransactionToDate,
  normalizeTransactionAmount
} from './accountBalances.js'
import { startingAccounts, startingTransactions } from './accountDefaults.js'
import { getMainAccountId, loadAccountData, loadSavedAccountData, saveAccountData, setMainAccount } from './accountStorage.js'
import PageHeader from './PageHeader'
import ResponsiveText from './ResponsiveText'
import { BILL_STORAGE_KEY, loadBillData, saveBillData } from './billData.js'
import { loadDebts, reconcileDebtPaymentForTransaction, removeDebtPaymentForTransaction } from './debtData.js'
import {
  getCategories,
  getDefaultCategoryForFlow,
  getReportingTransactions,
  getTransactionCategoryType,
  loadCategoryConfig,
  suggestTransactionCategory
} from './categoryData.js'
import { loadPayees } from './payeeData.js'
import FinancialInput from './FinancialInput'
import { parseFinancialAmount } from './financialAmounts.js'

const todayDate = new Date().toLocaleDateString('en-CA')

const money = amount =>
  amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

// editRequest ({ transactionId, accountId }) opens the editor for that exact transaction, so other screens
// (such as Reports) reuse this editor instead of duplicating it.
export default function Accounts({ editRequest = null, onEditConsumed, onEditFinished }) {
  const [initialAccountData] = useState(() =>
    loadAccountData(startingAccounts, startingTransactions)
  )
  const [startEdit] = useState(() => {
    if (!editRequest) return null
    const transaction = initialAccountData.transactions.find(item =>
      String(item.id) === String(editRequest.transactionId) &&
      (editRequest.accountId == null || String(item.accountId) === String(editRequest.accountId)))
    return transaction ? { transaction } : null
  })
  const openedFromRequest = useRef(Boolean(startEdit))
  const [accounts, setAccounts] = useState(initialAccountData.accounts)
  const [transactions, setTransactions] = useState(initialAccountData.transactions)
  const nextAccountId = useRef(
    initialAccountData.accounts.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1
  )
  const nextTransactionId = useRef(
    initialAccountData.transactions.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1
  )
  const nextTransactionSequence = useRef(
    getNextTransactionSequence(initialAccountData.transactions)
  )
  const [selectedAccount, setSelectedAccount] = useState(startEdit ? startEdit.transaction.accountId : null)
  const [screen, setScreen] = useState(startEdit ? 'register' : 'overview')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountType, setNewAccountType] = useState('Checking')
  const [newAccountOpeningBalance, setNewAccountOpeningBalance] = useState('')
  const [newAccountColor, setNewAccountColor] = useState('#B87522')
  const [newAccountDefaultCleared, setNewAccountDefaultCleared] = useState(false)
  const [newAccountIsMain, setNewAccountIsMain] = useState(false)
  const [transactionSort, setTransactionSort] = useState(() =>
    localStorage.getItem('money-honey-transaction-sort') === 'asc' ? 'asc' : 'desc'
  )
  const [newName, setNewName] = useState(startEdit?.transaction.name ?? '')
  const [newAmount, setNewAmount] = useState(startEdit ? String(Math.abs(startEdit.transaction.amount)) : '')
  const [newDate, setNewDate] = useState(startEdit?.transaction.date ?? todayDate)
  const [kind, setKind] = useState(startEdit && startEdit.transaction.amount > 0 ? 'income' : 'expense')
  const [categoryConfig] = useState(() => loadCategoryConfig())
  const [category, setCategory] = useState(startEdit ? startEdit.transaction.category ?? '' : getDefaultCategoryForFlow('out', categoryConfig))
  const [categoryType, setCategoryType] = useState(startEdit ? getTransactionCategoryType(startEdit.transaction, categoryConfig) : 'expense')
  const [categoryWasChosen, setCategoryWasChosen] = useState(Boolean(startEdit))
  const customCategories = categoryConfig.customCategories
  const builtInNames = categoryConfig.builtInNames
  const disabledBuiltIns = categoryConfig.disabledBuiltIns
  const [payees] = useState(() => loadPayees())
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(Boolean(startEdit))
  const [editingTransactionId, setEditingTransactionId] = useState(startEdit ? startEdit.transaction.id : null)
  const [deleteConfirmation, setDeleteConfirmation] = useState(null)
  const [openingDrafts, setOpeningDrafts] = useState({})
  const [inputError, setInputError] = useState('')

  useEffect(() => {
    const refreshAccountData = () => {
      const current = loadSavedAccountData()
      if (!current) return
      setAccounts(current.accounts)
      setTransactions(current.transactions)
      nextAccountId.current = current.accounts.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1
      nextTransactionId.current = current.transactions.reduce((maxId, item) => Math.max(maxId, item.id), 0) + 1
      nextTransactionSequence.current = getNextTransactionSequence(current.transactions)
    }
    window.addEventListener('money-honey-accounts-updated', refreshAccountData)
    window.addEventListener('storage', refreshAccountData)
    return () => {
      window.removeEventListener('money-honey-accounts-updated', refreshAccountData)
      window.removeEventListener('storage', refreshAccountData)
    }
  }, [])

  useEffect(() => {
    if (openedFromRequest.current && !isAddTransactionOpen) {
      openedFromRequest.current = false
      onEditFinished?.()
    }
  }, [isAddTransactionOpen, onEditFinished])

  const categoryOptions = getCategories(customCategories, kind, builtInNames, disabledBuiltIns)
  const categoryTransactions = getReportingTransactions(transactions, categoryConfig)
  // A credit can be tied to the expense category it refunds; Debt Payments is a different kind of record.
  const refundOptions = kind === 'income'
    ? getCategories(customCategories, 'expense', builtInNames, disabledBuiltIns).filter(item => item !== 'Debt Payments')
    : []
  const account = accounts.find(item => item.id === selectedAccount)

  const accountTransactions = account
    ? transactions.filter(item => item.accountId === selectedAccount)
    : []
  const registerBalances = account
    ? calculateAccountBalances(
      account.openingBalance,
      accountTransactions,
      transactionSort,
      account.openingDate
    )
    : null
  const rows = registerBalances?.rows ?? []
  const balance = registerBalances?.balance ?? 0
  const available = registerBalances?.available ?? 0
  const unclearedBalance = registerBalances?.unclearedBalance ?? 0
  const activeAccounts = accounts.filter(item => !item.archived)
  const mainAccountId = getMainAccountId(accounts)

  function updateAccounts(updater) {
    const nextAccounts = updater(accounts)
    setAccounts(nextAccounts)
    saveAccountData(nextAccounts, transactions)
  }

  function updateTransactions(updater) {
    const nextTransactions = updater(transactions)
    setTransactions(nextTransactions)
    saveAccountData(accounts, nextTransactions)
  }

  function openRegister(id) {
    setSelectedAccount(id)
    setShowAddAccount(false)
    setScreen('register')
  }

  function updateAccount(id, changes) {
    updateAccounts(current => current.map(item =>
      item.id === id ? { ...item, ...changes } : item
    ))
  }

  function reorderAccount(id, direction) {
    updateAccounts(current => {
      const active = current.filter(item => !item.archived)
      const archived = current.filter(item => item.archived)
      const index = active.findIndex(item => item.id === id)
      const target = index + direction
      if (target < 0 || target >= active.length) return current
      const reordered = [...active]
      ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
      return [...reordered, ...archived]
    })
  }

  function addAccount(event) {
    event.preventDefault()
    let openingBalance
    try {
      openingBalance = parseFinancialAmount(newAccountOpeningBalance || '0', 'Opening balance', { signed: true })
      if (!newAccountName.trim()) throw new Error('Enter an account name.')
    } catch (error) { setInputError(error.message); return }
    setInputError('')

    const id = nextAccountId.current++
    updateAccounts(current => {
      const next = [...current, {
        id,
        name: newAccountName.trim(),
        type: newAccountType,
        openingBalance,
        openingDate: todayDate,
        color: newAccountColor,
        defaultCleared: newAccountDefaultCleared,
        archived: false
      }]
      return newAccountIsMain ? setMainAccount(next, id) : next
    })
    setNewAccountIsMain(false)
    setNewAccountName('')
    setNewAccountOpeningBalance('')
    setShowAddAccount(false)
  }

  function deleteAccount(id) {
    const nextAccounts = accounts.filter(item => item.id !== id)
    const nextTransactions = transactions.filter(item => item.accountId !== id)
    setAccounts(nextAccounts)
    setTransactions(nextTransactions)
    saveAccountData(nextAccounts, nextTransactions)
  }

  function updateTransactionSort(sort) {
    setTransactionSort(sort)
    localStorage.setItem('money-honey-transaction-sort', sort)
  }

  function toggleCleared(id) {
    updateTransactions(current => current.map(item =>
      item.id === id ? { ...item, cleared: !item.cleared } : item
    ))
  }

  function updateDate(id, date) {
    if (!date) return
    const transaction = transactions.find(item => item.id === id)
    if (!transaction || transaction.date === date) return
    const sequence = nextTransactionSequence.current++
    updateTransactions(current => moveTransactionToDate(current, id, date, sequence))
  }

  function openEditTransaction(transaction) {
    setEditingTransactionId(transaction.id)
    setNewName(transaction.name)
    setNewAmount(String(Math.abs(transaction.amount)))
    setNewDate(transaction.date)
    setKind(transaction.amount < 0 ? 'expense' : 'income')
    setCategory(transaction.category ?? '')
    setCategoryType(getTransactionCategoryType(transaction, categoryConfig))
    setCategoryWasChosen(true)
    setIsAddTransactionOpen(true)
  }

  useEffect(() => {
    if (!editRequest) return
    const currentTransactions = loadSavedAccountData()?.transactions || initialAccountData.transactions
    const target = currentTransactions.find(item =>
      String(item.id) === String(editRequest.transactionId) &&
      (editRequest.accountId == null || String(item.accountId) === String(editRequest.accountId)))
    if (target) {
      openedFromRequest.current = true
      setSelectedAccount(target.accountId)
      setScreen('register')
      openEditTransaction(target)
    } else {
      onEditFinished?.()
    }
    onEditConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])


  function getTransactionAssociations(transaction) {
    const billData = localStorage.getItem(BILL_STORAGE_KEY) === null
      ? { bills: [], incomes: [] }
      : loadBillData([])
    const debts = loadDebts()
    return {
      bill: transaction.linkedOccurrenceType === 'bill'
        || transaction.linkedOccurrenceId?.startsWith('bill:')
        || transaction.linkedBillOccurrenceId != null
        || billData.bills.some(bill =>
          bill.paymentHistory?.some(entry => entry.transactionId === transaction.id)
        ),
      income: transaction.linkedOccurrenceType === 'income'
        || transaction.linkedOccurrenceId?.startsWith('income:')
        || transaction.linkedIncomeOccurrenceId != null
        || billData.incomes.some(income =>
          income.paymentHistory?.some(entry => entry.transactionId === transaction.id)
        ),
      debt: transaction.linkedDebtId != null
        || transaction.linkedDebtPaymentId != null
        || debts.some(debt =>
          debt.paymentHistory.some(payment => payment.transactionId === transaction.id)
        )
    }
  }

  function openDeleteConfirmation() {
    const transaction = transactions.find(item => item.id === editingTransactionId)
    if (!transaction) return
    setDeleteConfirmation({
      transaction,
      associations: getTransactionAssociations(transaction)
    })
  }

  function deleteTransaction() {
    if (!deleteConfirmation) return
    const { transaction, associations } = deleteConfirmation
    if (!transactions.some(item => item.id === transaction.id)) {
      setDeleteConfirmation(null)
      setIsAddTransactionOpen(false)
      return
    }

    removeDebtPaymentForTransaction(transaction.id)
    if (associations.bill || associations.income) {
      const billData = localStorage.getItem(BILL_STORAGE_KEY) === null
        ? { bills: [], incomes: [] }
        : loadBillData([])
      const bills = billData.bills.map(bill => {
        const paymentHistory = (bill.paymentHistory ?? [])
          .filter(entry => entry.transactionId !== transaction.id)
        return paymentHistory.length === (bill.paymentHistory ?? []).length
          ? bill
          : { ...bill, paymentHistory }
      })
      const incomes = billData.incomes.map(income => {
        const paymentHistory = (income.paymentHistory ?? [])
          .filter(entry => entry.transactionId !== transaction.id)
        return paymentHistory.length === (income.paymentHistory ?? []).length
          ? income
          : { ...income, paymentHistory }
      })
      saveBillData({ bills, incomes })
    }
    updateTransactions(current => current.filter(item => item.id !== transaction.id))
    setDeleteConfirmation(null)
    setIsAddTransactionOpen(false)
    setEditingTransactionId(null)
  }

  function addTransaction(event) {
    event.preventDefault()

    let amount
    try {
      amount = parseFinancialAmount(newAmount, 'Transaction amount', { signed: true })
      if (!newName.trim() || !newDate || amount === 0) throw new Error('Enter a name, date, and nonzero transaction amount.')
    } catch (error) { setInputError(error.message); return }
    setInputError('')

    if (editingTransactionId !== null) {
      const currentTransaction = transactions.find(item => item.id === editingTransactionId)
      if (!currentTransaction) return
      const sequence = currentTransaction.date === newDate
        ? currentTransaction.sequence
        : nextTransactionSequence.current++
      updateTransactions(current => current.map(item =>
        item.id === editingTransactionId
          ? {
            ...item,
            sequence,
            name: newName.trim(),
            amount: normalizeTransactionAmount(amount, kind),
            date: newDate,
            category,
            categoryType
          }
          : item
      ))
      reconcileDebtPaymentForTransaction(editingTransactionId)
    } else {
      updateTransactions(current => [...current, {
        id: nextTransactionId.current++,
        sequence: nextTransactionSequence.current++,
        accountId: selectedAccount,
        name: newName.trim(),
        amount: normalizeTransactionAmount(amount, kind),
        date: newDate,
        cleared: account.defaultCleared,
        category: categoryWasChosen ? category : (category || getDefaultCategoryForFlow(kind === 'income' ? 'in' : 'out', categoryConfig)),
        categoryType
      }])
    }

    setNewName('')
    setNewAmount('')
    setEditingTransactionId(null)
    setIsAddTransactionOpen(false)
  }

  const card = {
    background: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    boxShadow: '0 3px 14px #76552212'
  }

  const field = {
    padding: 10,
    borderRadius: 10,
    border: '1px solid #E9D6B7',
    minWidth: 0
  }

  if (screen === 'overview') {
    return (
      <main className="accounts-overview" style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
        {inputError && <p role="alert">{inputError}</p>}
        <div className="page-heading-row page-title-row" style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18
        }}>
          <ResponsiveText style={{
            margin: 0,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#B87522'
          }}>
            Accounts
          </ResponsiveText>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              aria-label="Manage accounts"
              title="Manage Accounts"
              onClick={() => setScreen('manage')}
              style={{
                width: 40,
                height: 40,
                border: '1px solid #E9D6B7',
                borderRadius: 12,
                background: '#FFFFFF',
                color: '#79502A',
                fontSize: 18,
                cursor: 'pointer'
              }}
            >
              ✎
            </button>
            <button
              type="button"
              aria-label="Add account"
              className="theme-primary-action theme-add-button"
              title="Add Account"
              onClick={() => setShowAddAccount(current => !current)}
            >
              +
            </button>
          </div>
        </div>

        {showAddAccount && (
          <section style={card}>
            <h2 style={{ marginTop: 0 }}>Add Account</h2>
            <form onSubmit={addAccount} style={{ display: 'grid', gap: 10 }}>
              <input
                aria-label="Account name"
                placeholder="Account name"
                value={newAccountName}
                onChange={event => setNewAccountName(event.target.value)}
                style={field}
                required
              />
              <select
                aria-label="Account type"
                value={newAccountType}
                onChange={event => setNewAccountType(event.target.value)}
                style={field}
              >
                {['Checking', 'Savings', 'Cash', 'Credit Card', 'Investment', 'Other'].map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                <FinancialInput
                  signed
                  inputMode="decimal"
                  step="0.01"
                  aria-label="Opening balance"
                  placeholder="Opening balance"
                  value={newAccountOpeningBalance}
                  onChange={event => setNewAccountOpeningBalance(event.target.value)}
                  style={field}
                />
                <button type="button" aria-label="Toggle opening balance sign" onClick={() =>
                  setNewAccountOpeningBalance(value => value.startsWith('-') ? value.slice(1) : `-${value || '0'}`)
                } style={{ ...field, width: 'auto', flexShrink: 0 }}>+/-</button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Account color
                <input
                  type="color"
                  aria-label="Account color"
                  value={newAccountColor}
                  onChange={event => setNewAccountColor(event.target.value)}
                  style={{ width: 48, height: 34, border: 'none', background: 'transparent' }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={newAccountDefaultCleared}
                  onChange={event => setNewAccountDefaultCleared(event.target.checked)}
                />
                New transactions are cleared by default
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={newAccountIsMain}
                  onChange={event => setNewAccountIsMain(event.target.checked)}
                />
                Set as Main Account
              </label>
              <button type="submit" className="theme-primary-action" style={{
                background: '#B87522',
                color: '#FFFFFF',
                border: 'none',
                borderRadius: 12,
                padding: 12,
                fontWeight: 'bold'
              }}>
                Create Account
              </button>
            </form>
          </section>
        )}


        {activeAccounts.length === 0 && (
          <section style={card}>No active accounts. Add or restore an account to get started.</section>
        )}

        {activeAccounts.map(item => {
          const totals = calculateAccountBalances(
            item.openingBalance,
            transactions.filter(transaction => transaction.accountId === item.id),
            'asc',
            item.openingDate
          )
          return (
            <button
              key={item.id}
              type="button"
              className="account-overview-card"
              data-account-id={item.id}
              aria-label={`${item.name}, ${item.type}, Balance ${money(totals.balance)}, Available ${money(totals.available)}`}
              onClick={() => openRegister(item.id)}
              style={{ borderLeft: `5px solid ${item.color}` }}
            >
              <span className="account-overview-identity">
                <strong className="account-overview-name" title={item.name}>{item.name}</strong>
                <span className="account-overview-type">
                  {item.type}
                  {item.id === mainAccountId && <span className="account-overview-main"> · Main</span>}
                </span>
              </span>
              <span className="account-overview-totals">
                <strong className="account-overview-balance">{money(totals.balance)}</strong>
                <span className="account-overview-available">Available {money(totals.available)}</span>
              </span>
            </button>
          )
        })}
      </main>
    )
  }

  if (screen === 'manage') {
    return (
      <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
        {inputError && <p role="alert">{inputError}</p>}
        <div className="page-heading-row page-title-row" style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18
        }}>
          <ResponsiveText style={{
            margin: 0,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#B87522'
          }}>
            Manage Accounts
          </ResponsiveText>
          <button type="button" onClick={() => setScreen('overview')} style={{
            ...field,
            background: '#FFFFFF',
            color: '#79502A',
            cursor: 'pointer'
          }}>
            Done
          </button>
        </div>

        {accounts.map(item => {
          const activeIndex = activeAccounts.findIndex(accountItem => accountItem.id === item.id)
          return (
          <section key={item.id} style={{ ...card, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>{item.archived ? 'Archived Account' : item.name}</strong>
              {!item.archived && (
                <span>
                  <button
                    type="button"
                    aria-label={`Move ${item.name} up`}
                    onClick={() => reorderAccount(item.id, -1)}
                    disabled={activeIndex === 0}
                    style={{ ...field, padding: '4px 8px', marginRight: 4, cursor: 'pointer' }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${item.name} down`}
                    onClick={() => reorderAccount(item.id, 1)}
                    disabled={activeIndex === activeAccounts.length - 1}
                    style={{ ...field, padding: '4px 8px', cursor: 'pointer' }}
                  >
                    ↓
                  </button>
                </span>
              )}
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
              gap: 10,
              marginTop: 12
            }}>
              <label style={{ fontSize: 12, color: '#79502A' }}>
                Name
                <input
                  aria-label={`Name for ${item.name}`}
                  value={item.name}
                  onChange={event => updateAccount(item.id, { name: event.target.value })}
                  style={{ ...field, display: 'block', width: '100%', marginTop: 4 }}
                />
              </label>
              <label style={{ fontSize: 12, color: '#79502A' }}>
                Type
                <select
                  aria-label={`Type for ${item.name}`}
                  value={item.type}
                  onChange={event => updateAccount(item.id, { type: event.target.value })}
                  style={{ ...field, display: 'block', width: '100%', marginTop: 4 }}
                >
                  {['Checking', 'Savings', 'Cash', 'Credit Card', 'Investment', 'Other'].map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label style={{ fontSize: 12, color: '#79502A' }}>
                Opening balance
                <span style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <FinancialInput
                    signed
                    inputMode="decimal"
                    step="0.01"
                    aria-label={`Opening balance for ${item.name}`}
                    value={openingDrafts[item.id] ?? item.openingBalance}
                    onChange={event => {
                      const text = event.target.value
                      setOpeningDrafts({ ...openingDrafts, [item.id]: text })
                      if (event.currentTarget.validity.valid && text.trim()) {
                        updateAccount(item.id, { openingBalance: parseFinancialAmount(text, 'Opening balance', { signed: true }) })
                        setInputError('')
                      }
                    }}
                    onBlur={event => {
                      try {
                        const value = parseFinancialAmount(event.target.value, 'Opening balance', { signed: true })
                        updateAccount(item.id, { openingBalance: value })
                        setOpeningDrafts(current => { const next = { ...current }; delete next[item.id]; return next })
                        setInputError('')
                      } catch (error) { setInputError(error.message) }
                    }}
                    style={{ ...field, display: 'block', width: '100%' }}
                  />
                  <button type="button" aria-label={`Toggle opening balance sign for ${item.name}`} onClick={() =>
                    updateAccount(item.id, { openingBalance: -item.openingBalance })
                  } style={{ ...field, width: 'auto', flexShrink: 0 }}>+/-</button>
                </span>
              </label>
              <label style={{ fontSize: 12, color: '#79502A' }}>
                Reference date
                <input
                  type="date"
                  aria-label={`Reference date for ${item.name}`}
                  value={item.openingDate}
                  onChange={event => updateAccount(item.id, { openingDate: event.target.value })}
                  style={{ ...field, display: 'block', width: '100%', marginTop: 4 }}
                />
              </label>
              <label style={{ fontSize: 12, color: '#79502A' }}>
                Account color
                <input
                  type="color"
                  aria-label={`Color for ${item.name}`}
                  value={item.color}
                  onChange={event => updateAccount(item.id, { color: event.target.value })}
                  style={{ display: 'block', width: 48, height: 34, marginTop: 4, border: 'none', background: 'transparent' }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={item.defaultCleared}
                  onChange={event => updateAccount(item.id, { defaultCleared: event.target.checked })}
                />
                Cleared by default
              </label>
              {!item.archived && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    aria-label={`Set ${item.name} as Main Account`}
                    checked={item.id === mainAccountId}
                    onChange={event => updateAccounts(current => setMainAccount(current, event.target.checked ? item.id : null))}
                  />
                  Set as Main Account
                </label>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {item.archived ? (
                <button type="button" onClick={() => updateAccount(item.id, { archived: false })} style={field}>
                  Restore
                </button>
              ) : (
                <button type="button" onClick={() => updateAccounts(current => current.map(account => {
                  if (account.id !== item.id) return account
                  const archived = { ...account, archived: true }
                  delete archived.isMain
                  return archived
                }))} style={field}>
                  Archive
                </button>
              )}
              <button
                type="button"
                className="theme-danger-action"
                onClick={() => {
                  if (window.confirm(`Permanently delete ${item.name} and its transactions?`)) {
                    deleteAccount(item.id)
                  }
                }}
                style={{ ...field, color: '#9B463E' }}
              >
                Delete
              </button>
            </div>
          </section>
          )
        })}
      </main>
    )
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 210 }}>
      <PageHeader backLabel="Accounts" onBack={() => setScreen('overview')}>
        {account.name}
      </PageHeader>

      <section className="account-summary-card" aria-label="Account balances" style={{ ...card, background: '#F5D6A5', padding: 14 }}>
        <div className="account-balance-summary">
          <div className="account-summary-item">
            <p style={{ margin: 0, fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>
              BALANCE
            </p>
            <ResponsiveText as="strong" className="account-summary-value">
              {money(balance)}
            </ResponsiveText>
          </div>
          <div className="account-summary-item">
            <p style={{ margin: 0, fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>
              AVAILABLE
            </p>
            <ResponsiveText as="strong" className="account-summary-value">
              {money(available)}
            </ResponsiveText>
          </div>
          <div className="account-summary-item">
            <p style={{ margin: 0, fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>
              UNCLEARED
            </p>
            <ResponsiveText as="strong" className="account-summary-value" style={{
              color: unclearedBalance > 0 ? '#21834B' : unclearedBalance < 0 ? '#9B463E' : '#573B20'
            }}>
              {money(Math.abs(unclearedBalance))}
            </ResponsiveText>
            <span style={{
              display: 'block',
              marginTop: 3,
              color: '#79502A',
              fontSize: 10
            }}>
              {unclearedBalance > 0 ? 'Coming in' : unclearedBalance < 0 ? 'Going out' : 'No net amount'}
            </span>
          </div>
        </div>
      </section>

      <section style={{ ...card, padding: '10px 12px' }}>
        <div className="page-heading-row" style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 4
        }}>
          <ResponsiveText as="h2" className="account-transactions-title" style={{ margin: 0 }}>Transactions</ResponsiveText>
          <select
            aria-label="Transaction sorting order"
            value={transactionSort}
            onChange={event => updateTransactionSort(event.target.value)}
            style={{
              ...field,
              width: 'auto',
              maxWidth: '60%',
              padding: '6px 8px',
              fontSize: 12,
              background: '#FFFFFF'
            }}
          >
            <option value="desc">Newest First ↓</option>
            <option value="asc">Oldest First ↑</option>
          </select>
        </div>
        {rows.map(item => (
          <div
            key={item.id}
            className={`account-transaction-row${item.cleared ? '' : ' account-transaction-row-uncleared'}`}
            data-transaction-id={item.id}
            data-transaction-sequence={item.sequence}
            role="group"
            tabIndex={0}
            aria-label={`Transaction row: ${item.name}`}
            onClick={() => openEditTransaction(item)}
            onKeyDown={event => {
              if (event.target !== event.currentTarget) return
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openEditTransaction(item)
              }
            }}
            style={{
              display: 'grid',
              gridTemplateColumns: '24px minmax(0, 1.15fr) minmax(0, 1fr)',
              alignItems: 'center',
              columnGap: 6,
              padding: '2px 0',
              borderBottom: '1px solid #EEE5D9',
              cursor: 'pointer'
            }}
          >
            <button
              type="button"
              aria-label={item.cleared ? 'Mark pending' : 'Mark cleared'}
              aria-pressed={item.cleared}
              onClick={event => {
                event.stopPropagation()
                toggleCleared(item.id)
              }}
              style={{
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                border: 'none',
                borderRadius: '50%',
                padding: 0,
                cursor: 'pointer',
                background: 'transparent',
                color: item.cleared ? '#21834B' : '#9B948B',
                fontSize: 15,
                fontWeight: 'bold',
                lineHeight: 1
              }}
            >
              {item.cleared ? '✓' : '○'}
            </button>

            <div style={{
              minWidth: 0,
              justifySelf: 'stretch',
              textAlign: 'left'
            }}>
              <strong className="account-transaction-name" title={item.name} style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'left',
                fontSize: 14,
                lineHeight: 1.1
              }}>
                {item.name}
              </strong>
              <span className="account-transaction-date">
                <ResponsiveText as="time" dateTime={item.date} aria-hidden="true">
                  {new Date(`${item.date}T00:00:00Z`).toLocaleDateString('en-US', {
                    month: 'numeric', day: 'numeric', year: 'numeric', timeZone: 'UTC'
                  })}
                </ResponsiveText>
                <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M16 3v4M8 3v4M3 11h18" />
                </svg>
                <input
                  type="date"
                  aria-label={`Date for ${item.name}`}
                  value={item.date}
                  onClick={event => event.stopPropagation()}
                  onKeyDown={event => event.stopPropagation()}
                  onChange={event => updateDate(item.id, event.target.value)}
                />
              </span>
            </div>

            <div style={{
              minWidth: 0,
              justifySelf: 'stretch',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums'
            }}>
              <ResponsiveText as="strong" className="account-transaction-amount" style={{
                display: 'block',
                color: item.amount < 0 ? '#9B463E' : '#21834B',
                textAlign: 'right',
                whiteSpace: 'nowrap',
                lineHeight: 1.1
              }}>
                {money(item.amount)}
              </ResponsiveText>
              <ResponsiveText as="span" className="account-transaction-running" style={{
                display: 'block',
                marginTop: 1,
                color: '#79502A',
                textAlign: 'right',
                whiteSpace: 'nowrap',
                lineHeight: 1.1
              }}>
                {money(item.runningBalance)}
              </ResponsiveText>
            </div>
          </div>
        ))}
      </section>

      <button
        type="button"
        aria-label="Add transaction"
        className="theme-primary-action theme-add-button theme-floating-add theme-add-fixed"
        title="Add Transaction"
        onClick={() => {
          setEditingTransactionId(null)
          setDeleteConfirmation(null)
          setNewName('')
          setNewAmount('')
          setNewDate(todayDate)
          setKind('expense')
          setCategoryType('expense')
          setCategory(getDefaultCategoryForFlow('out', categoryConfig))
          setCategoryWasChosen(false)
          setIsAddTransactionOpen(true)
        }}
      >
        +
      </button>

      {isAddTransactionOpen && (
        <div
          onMouseDown={event => {
            if (event.target === event.currentTarget) {
              setDeleteConfirmation(null)
              setIsAddTransactionOpen(false)
            }
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
            aria-labelledby="add-transaction-title"
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
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14
            }}>
              <h2 id="add-transaction-title" style={{ margin: 0, color: '#79502A' }}>
                {editingTransactionId === null ? 'Add Transaction' : 'Edit Transaction'}
              </h2>
              <button
                type="button"
                aria-label={editingTransactionId === null ? 'Close add transaction' : 'Close edit transaction'}
                onClick={() => {
                  setDeleteConfirmation(null)
                  setIsAddTransactionOpen(false)
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#79502A',
                  fontSize: 24,
                  cursor: 'pointer'
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={addTransaction} style={{ display: 'grid', gap: 10 }}>
              {inputError && <p role="alert">{inputError}</p>}
              <select
                aria-label="Transaction type"
                value={kind}
                onChange={event => {
                  const nextKind = event.target.value
                  setKind(nextKind)
                  setCategoryType(nextKind)
                  setCategory(
                    suggestTransactionCategory(categoryTransactions, newName, nextKind, customCategories, builtInNames, disabledBuiltIns)
                    || getDefaultCategoryForFlow(nextKind === 'income' ? 'in' : 'out', categoryConfig)
                  )
                  setCategoryWasChosen(false)
                }}
                style={field}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <input
                placeholder="Payee or description"
                aria-label="Payee or description"
                list="saved-payees"
                value={newName}
                onChange={event => {
                  const value = event.target.value
                  setNewName(value)
                  if (!categoryWasChosen) {
                    setCategory(
                      suggestTransactionCategory(categoryTransactions, value, kind, customCategories, builtInNames, disabledBuiltIns)
                      || getDefaultCategoryForFlow(kind === 'income' ? 'in' : 'out', categoryConfig)
                    )
                  }
                }}
                style={field}
              />
              <datalist id="saved-payees">
                {payees.map(payee => <option key={payee} value={payee} />)}
              </datalist>
              <FinancialInput
                signed
                inputMode="decimal"
                step="0.01"
                placeholder="Amount"
                aria-label="Amount"
                value={newAmount}
                onChange={event => setNewAmount(event.target.value)}
                style={field}
              />
              <input
                type="date"
                aria-label="Transaction date"
                value={newDate}
                onChange={event => setNewDate(event.target.value)}
                style={field}
              />
              <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 12 }}>
                Category
                <select
                  aria-label="Transaction category"
                  value={kind === 'income' && category ? JSON.stringify([categoryType, category]) : category}
                  onChange={event => {
                    if (kind === 'income' && event.target.value) {
                      const [type, name] = JSON.parse(event.target.value)
                      setCategoryType(type)
                      setCategory(name)
                    } else {
                      setCategory(event.target.value)
                      setCategoryType(kind)
                    }
                    setCategoryWasChosen(true)
                  }}
                  style={field}
                >
                  <option value="">Uncategorized</option>
                  {editingTransactionId !== null && category !== ''
                    && !(kind === 'income' && categoryType === 'expense' ? refundOptions : categoryOptions).includes(category) && (
                    <option value={kind === 'income' ? JSON.stringify([categoryType, category]) : category}>{category} (not an active category)</option>
                  )}
                  {kind === 'income' ? (
                    <>
                      <optgroup label="Income">
                        {categoryOptions.map(item => <option key={item} value={JSON.stringify(['income', item])}>{item}</option>)}
                      </optgroup>
                      <optgroup label="Refund of an expense">
                        {refundOptions.map(item => <option key={`refund-${item}`} value={JSON.stringify(['expense', item])}>{item}</option>)}
                      </optgroup>
                    </>
                  ) : categoryOptions.map(item => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => {
                    setDeleteConfirmation(null)
                    setIsAddTransactionOpen(false)
                  }}
                  style={{
                    background: '#FFFFFF',
                    color: '#79502A',
                    border: '1px solid #E9D6B7',
                    borderRadius: 12,
                    padding: 12,
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button type="submit" className="theme-primary-action" style={{
                  background: '#B87522',
                  color: 'white',
                  border: 'none',
                  borderRadius: 12,
                  padding: 12,
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}>
                  {editingTransactionId === null ? 'Add Transaction' : 'Save Transaction'}
                </button>
              </div>
              {editingTransactionId !== null && (
                <button
                  type="button"
                  aria-label="Delete Transaction"
                  onClick={openDeleteConfirmation}
                  style={{
                    justifySelf: 'start',
                    border: 'none',
                    padding: '4px 2px',
                    background: 'transparent',
                    color: '#9B463E',
                    fontSize: 11,
                    fontWeight: 'bold',
                    cursor: 'pointer'
                  }}
                >
                  Delete Transaction
                </button>
              )}
            </form>
          </section>
        </div>
      )}
      {deleteConfirmation && (
        <div
          onMouseDown={event => {
            if (event.target === event.currentTarget) setDeleteConfirmation(null)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 31,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: '#33231266'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-transaction-title"
            style={{
              boxSizing: 'border-box',
              width: '100%',
              maxWidth: 380,
              padding: 20,
              borderRadius: 18,
              background: '#FFF8ED',
              boxShadow: '0 8px 30px #33231233'
            }}
          >
            <h2 id="delete-transaction-title" style={{ margin: '0 0 10px', color: '#79502A', fontSize: 18 }}>
              Delete Transaction?
            </h2>
            <p style={{ margin: '0 0 8px', color: '#493320', fontSize: 13 }}>
              Delete <strong>{deleteConfirmation.transaction.name}</strong> ({money(deleteConfirmation.transaction.amount)})?
            </p>
            {(deleteConfirmation.associations.bill
              || deleteConfirmation.associations.income
              || deleteConfirmation.associations.debt) && (
              <p style={{ margin: '0 0 14px', color: '#9B463E', fontSize: 12 }}>
                This transaction is linked to
                {deleteConfirmation.associations.bill ? ' a bill payment' : ''}
                {deleteConfirmation.associations.bill && deleteConfirmation.associations.income ? ' and' : ''}
                {deleteConfirmation.associations.income ? ' an income receipt' : ''}
                {(deleteConfirmation.associations.bill || deleteConfirmation.associations.income)
                  && deleteConfirmation.associations.debt ? ' and' : ''}
                {deleteConfirmation.associations.debt ? ' a debt payment' : ''}.
                {deleteConfirmation.associations.bill && ' The bill occurrence will return to Unpaid.'}
                {deleteConfirmation.associations.income && ' The income occurrence will return to Not Received.'}
                {deleteConfirmation.associations.debt && ' The associated debt payment will be reversed.'}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className="theme-secondary-action"
                onClick={() => setDeleteConfirmation(null)}
                style={{
                  background: '#FFFFFF',
                  color: '#79502A',
                  border: '1px solid #E9D6B7',
                  borderRadius: 12,
                  padding: 11,
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="theme-danger-action"
                onClick={deleteTransaction}
                style={{
                  background: '#9B463E',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 12,
                  padding: 11,
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}
              >
                Delete
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
