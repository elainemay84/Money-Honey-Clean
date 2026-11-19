import assert from 'node:assert/strict'
import test from 'node:test'
import { PAYEE_STORAGE_KEY, loadPayees, savePayees } from './payeeData.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('saved payees persist and remain unique', () => {
  const storage = createStorage()
  savePayees(['Walmart', ' Starbucks '], storage)
  assert.deepEqual(loadPayees(storage), ['Starbucks', 'Walmart'])
  for (const duplicate of ['Walmart', 'walmart', ' WALMART ']) {
    assert.throws(() => savePayees([...loadPayees(storage), duplicate], storage), /already exists/)
    assert.deepEqual(loadPayees(storage), ['Starbucks', 'Walmart'])
  }
})

test('large payee lists persist and new or renamed entries sort without changing spelling', () => {
  const storage = createStorage()
  const payees = [...Array.from({ length: 1500 }, (_, i) => `Payee ${i}`), 'zebra', 'ALPHA', 'apple']
  savePayees(payees, storage)
  assert.deepEqual(loadPayees(storage), [...payees].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
  savePayees(loadPayees(storage).map(name => name === 'zebra' ? 'Aardvark' : name), storage)
  assert.equal(loadPayees(storage)[0], 'Aardvark')
})

test('invalid payees and storage failures are explicit and leave previous data intact', () => {
  const storage = createStorage()
  savePayees(['Keep'], storage)
  assert.throws(() => savePayees(['Keep', '  '], storage), /Enter a payee name/)
  assert.deepEqual(loadPayees(storage), ['Keep'])
  assert.throws(() => savePayees(['New'], { getItem: () => null, setItem: () => { throw new DOMException('Full', 'QuotaExceededError') } }), /storage may be full or unavailable.*not saved/)
})

test('legacy case variants do not block unrelated additions or get silently removed', () => {
  const storage = createStorage()
  storage.setItem(PAYEE_STORAGE_KEY, JSON.stringify({ version: 1, payees: ['Coffee', 'coffee'] }))
  savePayees([...loadPayees(storage), 'New payee'], storage)
  assert.deepEqual(loadPayees(storage), ['Coffee', 'coffee', 'New payee'])
})

test('formatting variants are rejected without rewriting existing legacy payees', () => {
  const storage = createStorage()
  storage.setItem(PAYEE_STORAGE_KEY, JSON.stringify({ version: 1, payees: ["Joe's Market", 'JOES  MARKET'] }))
  const before = loadPayees(storage)
  for (const duplicate of ['joes market', 'JOE’S-MARKET', " Joe's   Market "]) {
    assert.throws(() => savePayees([...before, duplicate], storage), /already exists/)
    assert.deepEqual(loadPayees(storage), before)
  }
  assert.equal(savePayees([...before, 'Other'], storage).length, 3)
})

test('deleting a saved payee leaves transaction data independent', () => {
  const storage = createStorage()
  savePayees(['Walmart'], storage)
  savePayees([], storage)
  assert.deepEqual(loadPayees(storage), [])
})
