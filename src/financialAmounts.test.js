import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseFinancialAmount, parseInstallmentCount } from './financialAmounts.js'

test('financial text entry accepts large amounts, cents and signed transactions without rounding', () => {
  assert.equal(parseFinancialAmount('1,234,567.89'), 1234567.89)
  assert.equal(parseFinancialAmount('.05'), 0.05)
  assert.equal(parseFinancialAmount('-1234.56', 'Transaction', { signed: true }), -1234.56)
  assert.equal(parseFinancialAmount('', 'APR', { optional: true }), null)
  for (const value of ['1.234', 'NaN', 'Infinity', '1e6', '1,23.00', '', '-1']) {
    assert.throws(() => parseFinancialAmount(value))
  }
  assert.equal(parseInstallmentCount('06', 'Installments'), 6)
  for (const value of ['1.5', '-1', '', '1e2']) assert.throws(() => parseInstallmentCount(value, 'Installments'))
})
