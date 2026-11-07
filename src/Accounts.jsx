
import { useRef, useState } from 'react'
import {
  calculateAccountBalances,
  getNextTransactionSequence,
  moveTransactionToDate,
  normalizeTransactionAmount
} from './accountBalances.js'

const startingAccounts = [
  { id: 1, name: 'Everyday Checking', type: 'Checking', openingBalance: 1500, openingDate: '2026-11-06' },
  { id: 2, name: 'Savings', type: 'Savings', openingBalance: 500, openingDate: '2026-11-06' },
]

const startingTransactions = [
  { id: 1, sequence: 1, accountId: 1, name: 'Paycheck', amount: 1500, date: '2026-11-06', cleared: true },
  { id: 2, sequence: 2, accountId: 1, name: 'Groceries', amount: -125, date: '2026-11-06', cleared: true },
  { id: 3, sequence: 3, accountId: 1, name: 'Electric Bill', amount: -128, date: '2026-11-07', cleared: false },
  { id: 4, sequence: 4, accountId: 1, name: 'Gas', amount: -60, date: '2026-11-08', cleared: false },
]

const money = amount =>
  amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function Accounts() {
  const [accounts, setAccounts] = useState(startingAccounts)
  const [transactions, setTransactions] = useState(startingTransactions)
  const nextTransactionId = useRef(5)
  const nextTransactionSequence = useRef(getNextTransactionSequence(startingTransactions))
  const [selectedAccount, setSelectedAccount] = useState(1)
  const [transactionSort, setTransactionSort] = useState(() =>
    localStorage.getItem('money-honey-transaction-sort') === 'asc' ? 'asc' : 'desc'
  )
  const [newName, setNewName] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newDate, setNewDate] = useState(new Date().toLocaleDateString('en-CA'))
  const [kind, setKind] = useState('expense')

  const account = accounts.find(item => item.id === selectedAccount)

  const accountTransactions = transactions.filter(item => item.accountId === selectedAccount)
  const {
    rows,
    balance,
    available,
    unclearedBalance
  } = calculateAccountBalances(
    account.openingBalance,
    accountTransactions,
    transactionSort,
    account.openingDate
  )

  function updateOpeningBalance(value) {
    const openingBalance = value === '' ? 0 : Number(value)
    if (!Number.isFinite(openingBalance)) return

    setAccounts(current => current.map(item =>
      item.id === selectedAccount ? { ...item, openingBalance } : item
    ))
  }

  function updateOpeningDate(openingDate) {
    if (!openingDate) return
    setAccounts(current => current.map(item =>
      item.id === selectedAccount ? { ...item, openingDate } : item
    ))
  }

  function updateTransactionSort(sort) {
    setTransactionSort(sort)
    localStorage.setItem('money-honey-transaction-sort', sort)
  }

  function toggleCleared(id) {
    setTransactions(current => current.map(item =>
      item.id === id ? { ...item, cleared: !item.cleared } : item
    ))
  }

  function updateDate(id, date) {
    if (!date) return
    const transaction = transactions.find(item => item.id === id)
    if (!transaction || transaction.date === date) return
    const sequence = nextTransactionSequence.current++
    setTransactions(current => moveTransactionToDate(current, id, date, sequence))
  }

  function addTransaction(event) {
    event.preventDefault()

    const amount = Number(newAmount)
    if (!newName.trim() || !newDate || !Number.isFinite(amount) || amount === 0) return

    setTransactions(current => [...current, {
      id: nextTransactionId.current++,
      sequence: nextTransactionSequence.current++,
      accountId: selectedAccount,
      name: newName.trim(),
      amount: normalizeTransactionAmount(amount, kind),
      date: newDate,
      cleared: false
    }])

    setNewName('')
    setNewAmount('')
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

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <h1 style={{
        fontFamily: 'Georgia, serif',
        fontStyle: 'italic',
        textAlign: 'center',
        color: '#B87522'
      }}>
        My Accounts 🍯
      </h1>

      <section style={card}>
        <label htmlFor="account-select">Choose an Account</label>
        <select
          id="account-select"
          value={selectedAccount}
          onChange={event => setSelectedAccount(Number(event.target.value))}
          style={{ ...field, width: '100%', marginTop: 8 }}
        >
          {accounts.map(item => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </select>
      </section>

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
            <label htmlFor="opening-balance" style={{
              display: 'block',
              marginTop: 7,
              color: '#79502A',
              fontSize: 10
            }}>
              Opening balance
            </label>
            <input
              id="opening-balance"
              type="number"
              step="0.01"
              aria-label="Opening balance"
              value={account.openingBalance}
              onChange={event => updateOpeningBalance(event.target.value)}
              style={{
                boxSizing: 'border-box',
                display: 'block',
                width: '100%',
                maxWidth: 96,
                marginTop: 2,
                padding: '3px 4px',
                border: '1px solid #D7B57E',
                borderRadius: 6,
                background: '#FFF9EF',
                color: '#573B20',
                fontSize: 11
              }}
            />
            <label htmlFor="opening-reference-date" style={{
              display: 'block',
              marginTop: 4,
              color: '#79502A',
              fontSize: 10
            }}>
              Reference date
            </label>
            <input
              id="opening-reference-date"
              type="date"
              aria-label="Opening balance reference date"
              value={account.openingDate}
              onChange={event => updateOpeningDate(event.target.value)}
              style={{
                boxSizing: 'border-box',
                display: 'block',
                width: '100%',
                maxWidth: 120,
                marginTop: 2,
                padding: '2px',
                border: '1px solid #D7B57E',
                borderRadius: 6,
                background: '#FFF9EF',
                color: '#573B20',
                fontSize: 10
              }}
            />
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
        <p style={{ fontSize: 13, color: '#79502A' }}>
          Tap the checkmark to clear a transaction.
          Change dates directly without opening Edit.
        </p>

        {rows.map(item => (
          <div
            key={item.id}
            data-transaction-id={item.id}
            data-transaction-sequence={item.sequence}
            style={{
              display: 'grid',
              gridTemplateColumns: '24px minmax(0, 1fr) minmax(88px, 104px)',
              alignItems: 'center',
              columnGap: 8,
              padding: '5px 0',
              borderBottom: '1px solid #EEE5D9'
            }}
          >
            <button
              type="button"
              aria-label={item.cleared ? 'Mark pending' : 'Mark cleared'}
              aria-pressed={item.cleared}
              onClick={() => toggleCleared(item.id)}
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

      <section style={card}>
        <h2>Add Transaction</h2>
        <form onSubmit={addTransaction} style={{ display: 'grid', gap: 10 }}>
          <select value={kind} onChange={event => setKind(event.target.value)} style={field}>
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
          <button type="submit" style={{
            background: '#B87522',
            color: 'white',
            border: 'none',
            borderRadius: 12,
            padding: 14,
            fontWeight: 'bold',
            cursor: 'pointer'
          }}>
            + Add Transaction
          </button>
        </form>
      </section>
      <p style={{ textAlign: 'center', fontSize: 12 }}>
        Demo data only. Changes are not saved after a refresh.
      </p>
    </main>
  )
}
