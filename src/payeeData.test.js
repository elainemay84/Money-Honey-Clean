import assert from 'node:assert/strict'
import test from 'node:test'
import { loadPayees, savePayees } from './payeeData.js'

function createStorage() {
  const values = new Map()
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value)
  }
}

test('saved payees persist and remain unique', () => {
  const storage = createStorage()
  savePayees(['Walmart', 'Walmart', ' Starbucks '], storage)
  assert.deepEqual(loadPayees(storage), ['Walmart', 'Starbucks'])
})

test('deleting a saved payee leaves transaction data independent', () => {
  const storage = createStorage()
  savePayees(['Walmart'], storage)
  savePayees([], storage)
  assert.deepEqual(loadPayees(storage), [])
})
