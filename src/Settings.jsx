import { useState } from 'react'
import {
  getDefaultCategoryForFlow,
  getCategories,
  getCategoryId,
  loadCategoryConfig,
  renameCategory,
  saveCategoryConfig
} from './categoryData.js'
import { loadPayees, savePayees } from './payeeData.js'
import PageHeader from './PageHeader'

const field = {
  padding: 9,
  borderRadius: 9,
  border: '1px solid #E9D6B7',
  minWidth: 0,
  background: '#FFFFFF'
}

const card = {
  background: '#FFFFFF',
  padding: 16,
  borderRadius: 16,
  marginBottom: 12,
  boxShadow: '0 3px 14px #76552212'
}

export default function Settings({ onBack, transactions, onTransactionsChange }) {
  const [categoryConfig, setCategoryConfig] = useState(() => loadCategoryConfig())
  const [payees, setPayees] = useState(() => loadPayees())
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryType, setNewCategoryType] = useState('expense')
  const [newPayee, setNewPayee] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [editingCategory, setEditingCategory] = useState(null)
  const [categoryDraft, setCategoryDraft] = useState('')
  const [replacementCategory, setReplacementCategory] = useState('')
  const [categoryDeleteConfirmation, setCategoryDeleteConfirmation] = useState(null)
  const [payeeDeleteConfirmation, setPayeeDeleteConfirmation] = useState(null)
  const [editingPayee, setEditingPayee] = useState(null)
  const [payeeDraft, setPayeeDraft] = useState('')
  const [updatePayeeTransactions, setUpdatePayeeTransactions] = useState(false)
  const customCategories = categoryConfig.customCategories
  const builtInNames = categoryConfig.builtInNames
  const disabledBuiltIns = categoryConfig.disabledBuiltIns

  function addCategory(event) {
    event.preventDefault()
    const name = newCategoryName.trim()
    if (!name) return
    const allNames = [
      ...getCategories(customCategories, 'expense', builtInNames, disabledBuiltIns),
      ...getCategories(customCategories, 'income', builtInNames, disabledBuiltIns)
    ]
    if (allNames.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) return
    setCategoryConfig(saveCategoryConfig({
      customCategories: [...customCategories, { name, type: newCategoryType }],
      builtInNames,
      disabledBuiltIns
    }))
    setNewCategoryName('')
  }

  function openCategory(name, type) {
    setSelectedCategory(name)
    setEditingCategory({
      name,
      type,
      isCustom: customCategories.some(item => item.name === name)
    })
    setCategoryDraft(name)
    setReplacementCategory(getCategories(customCategories, type, builtInNames)
      .find(item => item !== name) ?? getDefaultCategoryForFlow(type === 'income' ? 'in' : 'out'))
  }

  function saveCategoryEdit() {
    if (!editingCategory || !categoryDraft.trim()) return
    const name = categoryDraft.trim()
    const oldName = editingCategory.name
    let nextConfig = categoryConfig
    if (editingCategory.isCustom) {
      nextConfig = saveCategoryConfig({
        customCategories: renameCategory(customCategories, oldName, name),
        builtInNames,
        disabledBuiltIns
      })
    } else {
      const id = getCategoryId(oldName, editingCategory.type, builtInNames)
      nextConfig = saveCategoryConfig({
        customCategories,
        builtInNames: id ? { ...builtInNames, [id]: name } : builtInNames,
        disabledBuiltIns
      })
    }
    setCategoryConfig(nextConfig)
    onTransactionsChange(transactions.map(transaction =>
      transaction.category === oldName ? { ...transaction, category: name } : transaction
    ))
    setEditingCategory(null)
  }

  function deleteCategory() {
    if (!editingCategory?.isCustom || !replacementCategory || !window.confirm(`Delete ${editingCategory.name} and reassign its transactions?`)) return
    const name = editingCategory.name
    const categoryId = getCategoryId(name, editingCategory.type, builtInNames)
    setCategoryConfig(saveCategoryConfig({
      customCategories: customCategories.filter(item => item.name !== name),
      builtInNames,
      disabledBuiltIns: categoryId
        ? [...disabledBuiltIns, categoryId]
        : disabledBuiltIns
    }))
    onTransactionsChange(transactions.map(transaction =>
      transaction.category === name ? { ...transaction, category: replacementCategory } : transaction
    ))
    setEditingCategory(null)
    setCategoryDeleteConfirmation(null)
  }

  function addPayee(event) {
    event.preventDefault()
    const name = newPayee.trim()
    if (!name) return
    setPayees(savePayees([...payees, name]))
    setNewPayee('')
  }

  function renamePayee(oldName, newName) {
    const name = newName.trim()
    if (!name || name === oldName) return
    setPayees(savePayees(payees.map(payee => payee === oldName ? name : payee)))
    if (updatePayeeTransactions) {
      onTransactionsChange(transactions.map(transaction =>
        transaction.name === oldName ? { ...transaction, name } : transaction
      ))
    }
    setEditingPayee(null)
  }

  return (
    <main style={{ maxWidth: 460, margin: 'auto', paddingBottom: 30 }}>
      <PageHeader backLabel="Settings" onBack={onBack}>Categories &amp; Payees</PageHeader>

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Categories</h2>
        </div>
        <form onSubmit={addCategory} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8, margin: '12px 0 14px' }}>
          <input id="new-category-name" aria-label="New category name" placeholder="New category" value={newCategoryName} onChange={event => setNewCategoryName(event.target.value)} style={field} />
          <select aria-label="New category type" value={newCategoryType} onChange={event => setNewCategoryType(event.target.value)} style={field}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
          <button type="submit" style={{ ...field, padding: '9px 12px', background: '#B87522', color: '#FFFFFF', fontWeight: 'bold', whiteSpace: 'nowrap', cursor: 'pointer' }}>Add</button>
        </form>
        {[
          ['Expense categories', 'expense'],
          ['Income categories', 'income']
        ].map(([label, type]) => (
          <div key={type} style={{ marginTop: 12 }}>
            <h3 style={{ margin: '0 0 6px', color: '#79502A', fontSize: 12 }}>{label}</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {[...getCategories(customCategories, type, builtInNames, disabledBuiltIns)].map(name => (
                <button key={name} type="button" onClick={() => openCategory(name, type)} style={{
                  ...field, padding: '5px 8px', fontSize: 11, color: '#79502A', cursor: 'pointer',
                  background: selectedCategory === name ? '#F5D6A5' : '#FFF8ED'
                }}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section style={card}>
        <h2 style={{ margin: '0 0 10px', fontSize: 18 }}>Saved Payees</h2>
        <form onSubmit={addPayee} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, marginBottom: 14 }}>
          <input aria-label="New payee name" placeholder="Payee or merchant" value={newPayee} onChange={event => setNewPayee(event.target.value)} style={{ ...field, flex: 1 }} />
          <button type="submit" aria-label="Add payee" style={{ ...field, padding: '9px 12px', background: '#B87522', color: '#FFFFFF', fontWeight: 'bold', whiteSpace: 'nowrap', cursor: 'pointer' }}>Add</button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {payees.map(payee => (
            <button key={payee} type="button" onClick={() => {
              setEditingPayee(payee)
              setPayeeDraft(payee)
              setUpdatePayeeTransactions(false)
            }} style={{
              ...field,
              padding: '5px 8px',
              fontSize: 11,
              color: '#79502A',
              cursor: 'pointer',
              background: '#FFF8ED',
              maxWidth: '100%',
              overflowWrap: 'anywhere'
            }}>
              {payee}
            </button>
          ))}
        </div>
        {payees.length === 0 && <p style={{ margin: '10px 0 0', color: '#79502A', fontSize: 12 }}>Saved payees will appear here.</p>}
      </section>
      {(editingCategory || editingPayee) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 30, display: 'grid', placeItems: 'center', padding: 20, background: '#33231266' }}>
          <section role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 380, padding: 18, borderRadius: 16, background: '#FFF8ED' }}>
            <h2 style={{ margin: '0 0 12px', color: '#79502A', fontSize: 18 }}>
              {editingCategory ? 'Edit Category' : 'Edit Payee'}
            </h2>
            <input
              aria-label={editingCategory ? 'Category name' : 'Payee name'}
              value={editingCategory ? categoryDraft : payeeDraft}
              onChange={event => editingCategory ? setCategoryDraft(event.target.value) : setPayeeDraft(event.target.value)}
              style={{ ...field, width: '100%', boxSizing: 'border-box' }}
            />
            {editingCategory?.isCustom && (
              <>
                <label style={{ display: 'grid', gap: 4, marginTop: 10, color: '#79502A', fontSize: 12 }}>
                  Replacement for existing transactions when deleting
                  <select value={replacementCategory} onChange={event => setReplacementCategory(event.target.value)} style={field}>
                    {getCategories(customCategories, editingCategory.type, builtInNames, disabledBuiltIns)
                      .filter(item => item !== editingCategory.name)
                      .map(item => <option key={item} value={item}>{item}</option>)}
                  </select>
                </label>
              </>
            )}
            {editingPayee && (
              <>
                <label style={{ display: 'flex', gap: 8, marginTop: 10, color: '#79502A', fontSize: 12 }}>
                  <input type="checkbox" checked={updatePayeeTransactions} onChange={event => setUpdatePayeeTransactions(event.target.checked)} />
                  Update existing transaction descriptions
                </label>
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => { setEditingCategory(null); setEditingPayee(null) }} style={field}>Cancel</button>
              <button type="button" onClick={editingCategory ? saveCategoryEdit : () => renamePayee(editingPayee, payeeDraft)} style={{ ...field, background: '#B87522', color: '#FFFFFF', fontWeight: 'bold' }}>
                Save
              </button>
            </div>
            {editingCategory && (
              <button type="button" onClick={() => setCategoryDeleteConfirmation({
                name: editingCategory.name,
                type: editingCategory.type,
                replacement: replacementCategory,
                transactionCount: transactions.filter(item => item.category === editingCategory.name).length
              })} style={{ marginTop: 10, border: 'none', background: 'transparent', color: '#9B463E', cursor: 'pointer' }}>
                Delete Category
              </button>
            )}
            {editingPayee && (
              <button type="button" onClick={() => setPayeeDeleteConfirmation(editingPayee)} style={{ marginTop: 10, border: 'none', background: 'transparent', color: '#9B463E', cursor: 'pointer' }}>
                Delete Payee
              </button>
            )}
          </section>
        </div>
      )}
      {categoryDeleteConfirmation && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 31, display: 'grid', placeItems: 'center', padding: 20, background: '#33231266' }}>
          <section role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 380, padding: 18, borderRadius: 16, background: '#FFF8ED' }}>
            <h2 style={{ margin: '0 0 10px', color: '#79502A', fontSize: 18 }}>Delete Category?</h2>
            <p style={{ margin: '0 0 10px', color: '#493320', fontSize: 13 }}>
              Delete <strong>{categoryDeleteConfirmation.name}</strong>?
            </p>
            {categoryDeleteConfirmation.transactionCount > 0 && (
              <label style={{ display: 'grid', gap: 4, color: '#79502A', fontSize: 12 }}>
                Reassign {categoryDeleteConfirmation.transactionCount} transaction{categoryDeleteConfirmation.transactionCount === 1 ? '' : 's'} to
                <select value={replacementCategory} onChange={event => setReplacementCategory(event.target.value)} style={field}>
                  {getCategories(customCategories, categoryDeleteConfirmation.type, builtInNames, disabledBuiltIns)
                    .filter(item => item !== categoryDeleteConfirmation.name)
                    .map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 14 }}>
              <button type="button" onClick={() => setCategoryDeleteConfirmation(null)} style={field}>Cancel</button>
              <button type="button" onClick={deleteCategory} style={{ ...field, background: '#9B463E', color: '#FFFFFF', fontWeight: 'bold' }}>Delete</button>
            </div>
          </section>
        </div>
      )}
      {payeeDeleteConfirmation && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 31, display: 'grid', placeItems: 'center', padding: 20, background: '#33231266' }}>
          <section role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 380, padding: 18, borderRadius: 16, background: '#FFF8ED' }}>
            <h2 style={{ margin: '0 0 10px', color: '#79502A', fontSize: 18 }}>Delete Payee?</h2>
            <p style={{ margin: '0 0 14px', color: '#493320', fontSize: 13 }}>Delete <strong>{payeeDeleteConfirmation}</strong>? Transactions will not be deleted.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button type="button" onClick={() => setPayeeDeleteConfirmation(null)} style={field}>Cancel</button>
              <button type="button" onClick={() => {
                setPayees(savePayees(payees.filter(item => item !== payeeDeleteConfirmation)))
                setPayeeDeleteConfirmation(null)
                setEditingPayee(null)
              }} style={{ ...field, background: '#9B463E', color: '#FFFFFF', fontWeight: 'bold' }}>Delete</button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
