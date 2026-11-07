
import { useState } from 'react'
import Accounts from './Accounts'

const initialBills = [
  { name: 'Mortgage', amount: 1250, paid: true },
  { name: 'Internet', amount: 85, paid: true },
  { name: 'Electric', amount: 128, paid: false },
  { name: 'Discover Card', amount: 214, paid: false },
]

function App() {
  const [bills, setBills] = useState(initialBills)
  const [activePage, setActivePage] = useState('Home')

  const remainingBills = bills
    .filter(bill => !bill.paid)
    .reduce((sum, bill) => sum + bill.amount, 0)

  function toggleBill(index) {
    setBills(current =>
      current.map((bill, i) =>
        i === index ? { ...bill, paid: !bill.paid } : bill
      )
    )
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#FFF8ED',
      color: '#493320',
      fontFamily: 'Arial, sans-serif',
      padding: '24px'
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
          <h2>Bills Before Payday</h2>

          {bills.map((bill, index) => (
            <div
              key={bill.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 0',
                borderBottom: '1px solid #EEE5D9'
              }}
            >
              <input
                type="checkbox"
                checked={bill.paid}
                onChange={() => toggleBill(index)}
              />
              <span style={{ flex: 1 }}>{bill.name}</span>
              <strong>${bill.amount}</strong>
            </div>
          ))}

          <p>
            Bills remaining: <strong>${remainingBills}</strong>
          </p>
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
  display: 'flex',
  justifyContent: 'space-around',
  alignItems: 'center',
  background: '#FFF3DF',
  borderTop: '1px solid #E9D6B7',
  borderRadius: 18,
  padding: '16px 8px',
  marginTop: 24,
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
