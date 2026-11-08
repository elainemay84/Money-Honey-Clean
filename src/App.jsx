
import { useEffect, useState } from 'react'
import Accounts from './Accounts'
import { startingAccounts, startingTransactions } from './accountDefaults.js'
import Bills from './Bills'
import {
  createDemoBills,
  getTodayDate,
  getPaydayBillSummary,
  getPaydayIncomeSummary,
  getPaySchedulePeriod,
  loadBills,
  loadIncomeSchedules,
  loadPaySchedule,
  savePaySchedule
} from './billData.js'
import { loadAccountData, loadSavedAccountData } from './accountStorage.js'

const money = amount => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

function App() {
  const [today] = useState(getTodayDate)
  const [bills, setBills] = useState(() => loadBills(createDemoBills()))
  const [incomeSchedules, setIncomeSchedules] = useState(() => loadIncomeSchedules())
  const [paySchedule, setPaySchedule] = useState(() => loadPaySchedule())
  const [accountData, setAccountData] = useState(() =>
    loadAccountData(startingAccounts, startingTransactions)
  )
  const [isEditingPaySchedule, setIsEditingPaySchedule] = useState(false)
  const [payFrequency, setPayFrequency] = useState(paySchedule?.frequency ?? 'biweekly')
  const [nextPayday, setNextPayday] = useState(paySchedule?.nextPayday ?? today)
  const [activePage, setActivePage] = useState('Home')
  const paydayPeriod = getPaySchedulePeriod(paySchedule, today)
  const transactions = accountData?.transactions ?? []
  const paydaySummary = getPaydayBillSummary(bills, paydayPeriod, transactions)
  const paydayIncome = getPaydayIncomeSummary(incomeSchedules, paydayPeriod, transactions)

  useEffect(() => {
    const refreshData = () => {
      setBills(loadBills(createDemoBills()))
      setIncomeSchedules(loadIncomeSchedules())
    }
    window.addEventListener('money-honey-bills-updated', refreshData)
    window.addEventListener('storage', refreshData)
    return () => {
      window.removeEventListener('money-honey-bills-updated', refreshData)
      window.removeEventListener('storage', refreshData)
    }
  }, [])

  useEffect(() => {
    const refreshAccountData = () => setAccountData(loadSavedAccountData())
    window.addEventListener('money-honey-accounts-updated', refreshAccountData)
    window.addEventListener('storage', refreshAccountData)
    return () => {
      window.removeEventListener('money-honey-accounts-updated', refreshAccountData)
      window.removeEventListener('storage', refreshAccountData)
    }
  }, [])

  function savePaydaySchedule(event) {
    event.preventDefault()
    if (!nextPayday) return
    const schedule = { frequency: payFrequency, nextPayday }
    savePaySchedule(schedule)
    setPaySchedule(schedule)
    setIsEditingPaySchedule(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FFF8ED',
      color: '#493320',
      fontFamily: 'Arial, sans-serif',
      padding: '24px 24px calc(112px + env(safe-area-inset-bottom))'
    }}>
      
{activePage === 'Home' ? (
      <main style={{ maxWidth: 460, margin: 'auto' }}>
        <h1 style={{
          color: '#B87522',
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          textAlign: 'center'
        }}>
          Money, Honey 🍯
        </h1>

        <p>Good morning! Here's your financial snapshot.</p>

        <section style={{
          background: '#F5D6A5',
          padding: 24,
          borderRadius: 20,
          marginBottom: 18
        }}>
          <p>LEFT UNTIL PAYDAY</p>
          <h2 style={{ fontSize: 38, margin: '8px 0' }}>
            $1,284
          </h2>
          <p>Example paycheck plan</p>
        </section>

        <section style={{
          background: '#FFFFFF',
          padding: 20,
          borderRadius: 20,
          marginBottom: 18
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
            marginBottom: 16
          }}>
            <h2 style={{ margin: 0 }}>Bills Before Payday</h2>
            {paySchedule && !isEditingPaySchedule && (
              <button
                type="button"
                onClick={() => setIsEditingPaySchedule(true)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#B87522',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                Edit schedule
              </button>
            )}
          </div>

          {!paySchedule || isEditingPaySchedule ? (
            <div>
              <p style={{ margin: '0 0 12px', color: '#79502A', fontSize: 13 }}>
                {paySchedule
                  ? 'Update your payday schedule to calculate this period’s bill summary.'
                  : 'Set up your payday schedule to see bills due during your current pay period.'}
              </p>
              <form onSubmit={savePaydaySchedule} style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'grid', gap: 5, color: '#79502A', fontSize: 12 }}>
                  Pay frequency
                  <select
                    value={payFrequency}
                    onChange={event => setPayFrequency(event.target.value)}
                    style={{ padding: 9, border: '1px solid #E9D6B7', borderRadius: 10, background: '#FFFFFF' }}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="biweekly">Every two weeks</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 5, color: '#79502A', fontSize: 12 }}>
                  Next payday
                  <input
                    type="date"
                    value={nextPayday}
                    onChange={event => setNextPayday(event.target.value)}
                    required
                    style={{ padding: 9, border: '1px solid #E9D6B7', borderRadius: 10, background: '#FFFFFF' }}
                  />
                </label>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  {paySchedule && (
                    <button
                      type="button"
                      onClick={() => setIsEditingPaySchedule(false)}
                      style={{
                        border: '1px solid #E9D6B7',
                        borderRadius: 10,
                        padding: '8px 12px',
                        background: '#FFFFFF',
                        color: '#79502A',
                        cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    style={{
                      border: 'none',
                      borderRadius: 10,
                      padding: '8px 12px',
                      background: '#B87522',
                      color: '#FFFFFF',
                      fontWeight: 'bold',
                      cursor: 'pointer'
                    }}
                  >
                    Save schedule
                  </button>
                </div>
              </form>
            </div>
          ) : paydaySummary ? (
            <>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 8,
                marginBottom: 14
              }}>
                {[
                  ['TOTAL DUE', paydaySummary.totalDue, '#B87522'],
                  ['CLEARED', paydaySummary.cleared, '#21834B'],
                  ['REMAINING', paydaySummary.remaining, '#9B463E']
                ].map(([label, amount, color]) => (
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
                      {money(amount)}
                    </strong>
                  </div>
                ))}
              </div>
              <div
                role="progressbar"
                aria-label="Bills cleared"
                aria-valuemin={0}
                aria-valuemax={paydaySummary.totalCount}
                aria-valuenow={paydaySummary.clearedCount}
                style={{ height: 7, overflow: 'hidden', borderRadius: 999, background: '#F1EEE9' }}
              >
                <div style={{
                  width: paydaySummary.totalCount
                    ? `${(paydaySummary.clearedCount / paydaySummary.totalCount) * 100}%`
                    : '0%',
                  height: '100%',
                  borderRadius: 999,
                  background: '#6E9A72',
                  transition: 'width 160ms ease'
                }} />
              </div>
              <p style={{ margin: '7px 0 0', color: '#79502A', fontSize: 12 }}>
                {paydaySummary.clearedCount} of {paydaySummary.totalCount} bills cleared
              </p>
              {paydayIncome && paydayIncome.totalCount > 0 && (
                <div style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid #EEE5D9',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 10,
                  color: '#79502A',
                  fontSize: 12
                }}>
                  <span>Income this pay period <small>(received {money(paydayIncome.received)} of {money(paydayIncome.totalExpected)})</small></span>
                  <strong style={{ color: '#21834B', whiteSpace: 'nowrap' }}>
                    {money(paydayIncome.stillExpected)} expected
                  </strong>
                </div>
              )}
            </>
          ) : (
            <p style={{ margin: 0, color: '#79502A', fontSize: 13 }}>
              Your payday schedule is invalid. Edit it to refresh this summary.
            </p>
          )}
        </section>

        <section style={{
          background: '#FFFFFF',
          padding: 20,
          borderRadius: 20,
          marginBottom: 18
        }}>
          <h2>Everyday Spending</h2>
          <p>Groceries: $420</p>
          <p>Gas: $160</p>
        </section>

        <section style={{
          background: '#FFFFFF',
          padding: 20,
          borderRadius: 20
        }}>
          <h2>Debt Journey</h2>
          <progress value="68" max="100" style={{ width: '100%' }} />
          <p>68% complete</p>
        </section>

        <p style={{ textAlign: 'center', marginTop: 24 }}>
          Made with a little buzz and a lot of honey. 🐝
        </p>
      </main>


) : activePage === 'Accounts' ? (
  <Accounts />
) : activePage === 'Bills' ? (
  <Bills />
) : (
  <main style={{
    maxWidth: 460,
    margin: 'auto',
    minHeight: '65vh',
    padding: '30px 10px',
    textAlign: 'center'
  }}>
    <h1 style={{
      fontFamily: 'Georgia, serif',
      color: '#B87522'
    }}>
      {activePage === 'Ask Honey' ? '🐝 Ask Honey' : activePage}
    </h1>
    <p style={{ color: '#79502A' }}>
      Your {activePage} page is coming together! 🍯
    </p>
  </main>
)}



<nav style={{
  position: 'fixed',
  left: 24,
  right: 24,
  bottom: 'env(safe-area-inset-bottom)',
  zIndex: 15,
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  background: '#FFF3DF',
  borderTop: '1px solid #E9D6B7',
  borderRadius: 18,
  padding: '16px 8px',
  marginTop: 0,
  gap: 4,
  fontFamily: 'Arial, sans-serif'
}}>
  {[
    ['🏠', 'Home'],
    ['💰', 'Accounts'],
    ['📅', 'Bills'],
    ['💳', 'Debt'],
    ['🐝', 'Ask Honey'],
    ['⚙️', 'More']
  ].map(([symbol, label]) => (
<div
  key={label}
  onClick={() => setActivePage(label)}
  style={{
      textAlign: 'center',
      fontSize: 12,
      color: '#79502A',
cursor: 'pointer',
fontWeight: activePage === label ? 'bold' : 'normal',
opacity: activePage === label ? 1 : 0.6
    }}>
      <div style={{ fontSize: 22, marginBottom: 4 }}>
        {symbol}
      </div>
      {label}
    </div>
  ))}
</nav>

    </div>
  )
}

export default App
