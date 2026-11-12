import assert from 'node:assert/strict'
import test from 'node:test'
import { APPEARANCE_SIZE_STORAGE_KEY, loadAppearanceSize, saveAppearanceSize } from './appearanceData.js'

function withStorage(values = {}) {
  const original = globalThis.localStorage
  const data = new Map(Object.entries(values))
  globalThis.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value))
  }
  return () => {
    globalThis.localStorage = original
  }
}

test('appearance size defaults to medium and persists each supported size', () => {
  const restore = withStorage()
  assert.equal(loadAppearanceSize(), 'medium')
  assert.equal(saveAppearanceSize('small'), 'small')
  assert.equal(loadAppearanceSize(), 'small')
  assert.equal(saveAppearanceSize('large'), 'large')
  assert.equal(loadAppearanceSize(), 'large')
  assert.equal(globalThis.localStorage.getItem(APPEARANCE_SIZE_STORAGE_KEY), 'large')
  restore()
})

test('invalid appearance sizes fall back to medium', () => {
  const restore = withStorage({ [APPEARANCE_SIZE_STORAGE_KEY]: 'giant' })
  assert.equal(loadAppearanceSize(), 'medium')
  assert.equal(saveAppearanceSize('giant'), 'medium')
  restore()
})
