import assert from 'node:assert/strict'
import test from 'node:test'
import {
  generateConfirmationCode,
  isConfirmationMatch,
  nextConfirmationCode,
  sanitizeCodeInput
} from './deleteCodeData.js'

const fixedRandom = (...values) => {
  const queue = [...values]
  return buffer => { buffer[0] = queue.shift() }
}

test('codes are four digits, keep leading zeros, and come from secure random values', () => {
  assert.equal(generateConfirmationCode(fixedRandom(7)), '0007')
  assert.equal(generateConfirmationCode(fixedRandom(9999)), '9999')
  for (let index = 0; index < 500; index += 1) {
    assert.match(generateConfirmationCode(), /^\d{4}$/)
  }
})

test('values that would bias the result are redrawn', () => {
  const limit = Math.floor(0x100000000 / 10000) * 10000
  assert.equal(generateConfirmationCode(fixedRandom(limit, limit + 5, 1234)), '1234')
})

test('code creation fails closed when secure randomness is unavailable', () => {
  assert.throws(() => generateConfirmationCode(null), /unavailable/)
})

test('every attempt gets a code different from the previous one', () => {
  const repeats = fixedRandom(4821, 4821, 4821, 1000)
  assert.equal(nextConfirmationCode('4821', () => generateConfirmationCode(repeats)), '1000')
  assert.throws(() => nextConfirmationCode('4821', () => '4821'), /Could not create/)
  assert.throws(() => nextConfirmationCode(null, () => 'abcd'), /Could not create/)
})

test('only the exact displayed code matches', () => {
  assert.equal(isConfirmationMatch('4821', '4821'), true)
  for (const typed of ['', '482', '48211', ' 4821', '4821 ', '4 821', '4812', 4821, null, undefined]) {
    assert.equal(isConfirmationMatch(typed, '4821'), false, String(typed))
  }
  for (const code of [null, undefined, '', 'abcd', '123']) {
    assert.equal(isConfirmationMatch(code, code), false, String(code))
  }
})

test('typed input is reduced to at most four digits', () => {
  assert.equal(sanitizeCodeInput('48a2 1x9'), '4821')
  assert.equal(sanitizeCodeInput(null), '')
})
