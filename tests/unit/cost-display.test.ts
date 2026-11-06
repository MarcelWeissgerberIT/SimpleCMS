import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerMoneyDisplay, fmtUsd, fmtCost, displayCurrency, parseAmount } from '../../src/app/lib/money.ts'
import { keyOfOther } from '../../src/shared/ai/providers.ts'

test('EUR display converts all USD inputs, tiny costs too, without changing the inputs', () => {
  const price = { usd: 4.5 }
  registerMoneyDisplay(() => ({ currency: 'EUR', eurPerUsd: 0.8 }))
  try {
    assert.equal(fmtUsd(price.usd, 'de'), '3,60 €')
    assert.equal(fmtCost(0.005, 'de'), '0,0040 €')
    assert.equal(fmtUsd(0.001, 'en'), '< €0.01')
    assert.deepEqual(price, { usd: 4.5 })
    assert.equal(parseAmount('5,00', 'de'), 5)
  } finally { registerMoneyDisplay(() => undefined) }
  assert.equal(fmtUsd(4.5, 'en'), '$4.50')
})
test('missing or invalid EUR rates keep a truthful USD display', () => {
  for (const rate of [undefined, 0, -1, NaN, Infinity]) {
    registerMoneyDisplay(() => ({ currency: 'EUR', eurPerUsd: rate }))
    assert.equal(displayCurrency(), 'USD')
    assert.equal(fmtUsd(2, 'en'), '$2.00')
  }
  registerMoneyDisplay(() => undefined)
})
test('worker providers with no key prefix never misclassify a direct API key', () => {
  assert.equal(keyOfOther('anthropic', 'sk-ant-example'), null)
  assert.equal(keyOfOther('openrouter', 'sk-or-v1-example'), null)
  assert.equal(keyOfOther('anthropic', 'sk-or-v1-example'), 'openrouter')
})
