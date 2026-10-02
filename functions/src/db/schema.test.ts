import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduledWakeups } from './schema.js'

test('scheduledWakeups exposes both delivery mode columns', () => {
  assert.equal(scheduledWakeups.deliveryMode.name, 'delivery_mode')
  assert.equal(scheduledWakeups.chosenDeliveryMode.name, 'chosen_delivery_mode')
})

test('delivery mode columns are nullable so non-mode outcomes stay NULL', () => {
  assert.equal(scheduledWakeups.deliveryMode.notNull, false)
  assert.equal(scheduledWakeups.chosenDeliveryMode.notNull, false)
})
