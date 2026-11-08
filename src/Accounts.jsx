
import { useEffect, useRef, useState } from 'react'
import {
  calculateAccountBalances,
  getNextTransactionSequence,
  moveTransactionToDate,
  normalizeTransactionAmount
} from './accountBalances.js'
import { startingAccounts, startingTransactions } from './accountDefaults.js'
import { loadAccountData, loadSavedAccountData, saveAccountData } from './accountStorage.js'

const todayDate = new Date().toLocaleDateString('en-CA')

const money = amount =>
  amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function Accounts() {
  const [initialAccountData] = useState(() =>
    loadAccountData(startingAccounts, startingTransactions)
  )
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
  const [selectedAccount, setSelectedAccount] = useState(null)
  const [screen, setScreen] = useState('overview')
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [newAccountName, setNewAccountName] = useState('')
  const [newAccountType, setNewAccountType] = useState('Checking')
  const [newAccountOpeningBalance, setNewAccountOpeningBalance] = useState('')
  const [newAccountColor, setNewAccountColor] = useState('#B87522')
  const [newAccountDefaultCleared, setNewAccountDefaultCleared] = useState(false)
  const [transactionSort, setTransactionSort] = useState(() =>
    localStorage.getItem('money-honey-transaction-sort') === 'asc' ? 'asc' : 'desc'
  )
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDate, setNewDate] = useState(todayDate)
  const [kind, setKind] = useState('expense')
  const [isAddTransactionOpen, setIsAddTransactionOpen] = useState(false)
  const [editingTransactionId, setEditingTransactionId] = useState(null)

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
    const openingBalance = Number(newAccountOpeningBalance || 0)
    if (!newAccountName.trim() || !Number.isFinite(openingBalance)) return

    updateAccounts(current => [...current, {
      id: nextAccountId.current++,
      name: newAccountName.trim(),
      type: newAccountType,
      openingBalance,
      openingDate: todayDate,
      color: newAccountColor,
      defaultCleared: newAccountDefaultCleared,
      archived: false
    }])
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
    setIsAddTransactionOpen(true)
  }

  function addTransaction(event) {
    event.preventDefault()

    const amount = Number(newAmount)
    if (!newName.trim() || !newDate || !Number.isFinite(amount) || amount === 0) return

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
            date: newDate
          }
          : item
      ))
    } else {
      updateTransactions(current => [...current, {
        id: nextTransactionId.current++,
        sequence: nextTransactionSequence.current++,
        accountId: selectedAccount,
        name: newName.trim(),
        amount: normalizeTransactionAmount(amount, kind),
        date: newDate,
        cleared: account.defaultCleared
      }])
    }

    setNewName('')
    setNewAmount('')
    setEditingTransactionId(null)
    setIsAddTransactionOpen(false)
  }

  const card = {
    background: '#FFFFFF',
    padding: 20,
    borderRadius: 20,
    marginBottom: 18,
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
      <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18
        }}>
          <h1 style={{
            margin: 0,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#B87522'
          }}>
            Accounts 🍯
          </h1>
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
              title="Add Account"
              onClick={() => setShowAddAccount(current => !current)}
              style={{
                width: 40,
                height: 40,
                border: 'none',
                borderRadius: 12,
                background: '#B87522',
                color: '#FFFFFF',
                fontSize: 24,
                lineHeight: 1,
                cursor: 'pointer'
              }}
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
              <input
                type="number"
                step="0.01"
                aria-label="Opening balance"
                placeholder="Opening balance"
                value={newAccountOpeningBalance}
                onChange={event => setNewAccountOpeningBalance(event.target.value)}
                style={field}
              />
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
              <button type="submit" style={{
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
                      data-account-id={item.id}
                      onClick={() => openRegister(item.id)}
              style={{
                ...card,
                display: 'block',
                width: '100%',
                textAlign: 'left',
                color: '#493320',
                border: 'none',
                borderLeft: `5px solid ${item.color}`,
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong style={{ fontSize: 16 }}>{item.name}</strong>
                  <div style={{ marginTop: 4, color: '#79502A', fontSize: 12 }}>{item.type}</div>
                </div>
                <span aria-hidden="true" style={{ color: '#B87522', fontSize: 20 }}>›</span>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
                marginTop: 14
              }}>
                <span style={{ fontSize: 12, color: '#79502A' }}>
                  Balance <strong style={{ display: 'block', color: '#493320', fontSize: 15 }}>{money(totals.balance)}</strong>
                </span>
                <span style={{ fontSize: 12, color: '#79502A', textAlign: 'right' }}>
                  Available <strong style={{ display: 'block', color: '#493320', fontSize: 15 }}>{money(totals.available)}</strong>
                </span>
              </div>
            </button>
          )
        })}
      </main>
    )
  }

  if (screen === 'manage') {
    return (
      <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 18
        }}>
          <h1 style={{
            margin: 0,
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            color: '#B87522'
          }}>
            Manage Accounts
          </h1>
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
                <input
                  type="number"
                  step="0.01"
                  aria-label={`Opening balance for ${item.name}`}
                  value={item.openingBalance}
                  onChange={event => {
                    const value = Number(event.target.value)
                    if (Number.isFinite(value)) updateAccount(item.id, { openingBalance: value })
                  }}
                  style={{ ...field, display: 'block', width: '100%', marginTop: 4 }}
                />
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
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {item.archived ? (
                <button type="button" onClick={() => updateAccount(item.id, { archived: false })} style={field}>
                  Restore
                </button>
              ) : (
                <button type="button" onClick={() => updateAccount(item.id, { archived: true })} style={field}>
                  Archive
                </button>
              )}
              <button
                type="button"
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
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 18
      }}>
        <button
          type="button"
          onClick={() => setScreen('overview')}
          aria-label="Back to Accounts Overview"
          style={{
            ...field,
            background: '#FFFFFF',
            color: '#79502A',
            cursor: 'pointer'
          }}
        >
          ‹ Accounts
        </button>
        <h1 style={{
          flex: 1,
          margin: 0,
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          color: '#B87522',
          textAlign: 'right'
        }}>
          {account.name}
        </h1>
      </div>

      <section style={{ ...card, background: '#F5D6A5', padding: 14 }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          alignItems: 'start'
        }}>
          <div style={{ minWidth: 0, paddingRight: 7 }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>
              BALANCE
            </p>
            <strong style={{
              display: 'block',
              marginTop: 4,
              fontSize: 16,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {money(balance)}
            </strong>
          </div>
          <div style={{
            minWidth: 0,
            padding: '0 7px',
            borderLeft: '1px solid #D8B87F',
            borderRight: '1px solid #D8B87F'
          }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>
              AVAILABLE
            </p>
            <strong style={{
              display: 'block',
              marginTop: 4,
              fontSize: 16,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {money(available)}
            </strong>
          </div>
          <div style={{ minWidth: 0, paddingLeft: 7, textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: 10, fontWeight: 'bold', letterSpacing: 0.5 }}>
              UNCLEARED
            </p>
            <strong style={{
              display: 'block',
              marginTop: 4,
              fontSize: 16,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              color: unclearedBalance > 0 ? '#21834B' : unclearedBalance < 0 ? '#9B463E' : '#573B20'
            }}>
              {money(Math.abs(unclearedBalance))}
            </strong>
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

      <section style={card}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8
        }}>
          <h2 style={{ margin: 0 }}>Transactions</h2>
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
              gridTemplateColumns: '24px minmax(0, 1fr) minmax(88px, 104px)',
              alignItems: 'center',
              columnGap: 8,
              padding: '5px 0',
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
              justifySelf: 'start',
              textAlign: 'left'
            }}>
              <strong style={{
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                textAlign: 'left',
                lineHeight: 1.2
              }}>
                {item.name}
              </strong>
              <input
                type="date"
                aria-label={`Date for ${item.name}`}
                value={item.date}
                onClick={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
                onChange={event => updateDate(item.id, event.target.value)}
                style={{
                  display: 'block',
                  boxSizing: 'border-box',
                  width: 120,
                  maxWidth: '100%',
                  height: 18,
                  marginTop: 1,
                  padding: 0,
                  border: 'none',
                  borderRadius: 0,
                  background: 'transparent',
                  fontSize: 11,
                  color: '#79502A',
                  textAlign: 'left'
                }}
              />
            </div>

            <div style={{
              minWidth: 0,
              justifySelf: 'stretch',
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums'
            }}>
              <strong style={{
                display: 'block',
                fontSize: 14,
                color: item.amount < 0 ? '#9B463E' : '#21834B',
                textAlign: 'right',
                whiteSpace: 'nowrap',
                lineHeight: 1.2
              }}>
                {money(item.amount)}
              </strong>
              <span style={{
                display: 'block',
                marginTop: 1,
                fontSize: 11,
                color: '#79502A',
                textAlign: 'right',
                whiteSpace: 'nowrap',
                lineHeight: 1.2
              }}>
                {money(item.runningBalance)}
              </span>
            </div>
          </div>
        ))}
      </section>

      <button
        type="button"
        aria-label="Add transaction"
        title="Add Transaction"
        onClick={() => {
          setEditingTransactionId(null)
          setNewName('')
          setNewAmount('')
          setNewDate(todayDate)
          setKind('expense')
          setIsAddTransactionOpen(true)
        }}
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

      {isAddTransactionOpen && (
        <div
          onMouseDown={event => {
            if (event.target === event.currentTarget) setIsAddTransactionOpen(false)
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
                onClick={() => setIsAddTransactionOpen(false)}
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
              <select
                aria-label="Transaction type"
                value={kind}
                onChange={event => setKind(event.target.value)}
                style={field}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <input
                placeholder="Payee or description"
                aria-label="Payee or description"
                value={newName}
                onChange={event => setNewName(event.target.value)}
                style={field}
              />
              <input
                type="number"
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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setIsAddTransactionOpen(false)}
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
                <button type="submit" style={{
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
            </form>
          </section>
        </div>
      )}
    </main>
  )
}
