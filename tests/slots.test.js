import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOT_BUFFER_MINS, durationMins, occupiedSlots, overlaps } from '../lib/slots.js';

test('durations use the appointment map and default to 60 minutes', () => {
  assert.equal(SLOT_BUFFER_MINS, 45);
  for (const name of ['Standard Session', 'Block of 4 Sessions', 'Block of 6 Sessions']) assert.equal(durationMins(name), 45);
  for (const name of ['Initial Assessment', 'Extended Session', 'Starter Programme', 'Full Programme', 'unknown', undefined, 'constructor']) {
    assert.equal(durationMins(name), 60);
  }
});

test('occupied slots include the start and duration plus 45-minute buffer', () => {
  assert.deepEqual(occupiedSlots('18:00', 45), ['18:00', '18:30', '19:00']);
  assert.deepEqual(occupiedSlots('18:00', 60), ['18:00', '18:30', '19:00', '19:30']);
  assert.deepEqual(occupiedSlots('00:00', 45), ['00:00', '00:30', '01:00']);
});

test('occupied slots stop before midnight without wrapping into the next day', () => {
  assert.deepEqual(occupiedSlots('23:00', 60), ['23:00', '23:30']);
  assert.deepEqual(occupiedSlots('23:45', 60), ['23:45']);
});

test('an earlier start cannot overlap a later appointment', () => {
  const taken = occupiedSlots('18:30', 60);
  assert.equal(overlaps(taken, '18:00', 60), true);
  assert.equal(overlaps(new Set(taken), '18:00', 60), true);
  assert.equal(overlaps(taken, '16:30', 60), false);
});

test('a 45-minute visit at 18:00 permits 19:30, but a 60-minute visit does not', () => {
  assert.equal(overlaps(occupiedSlots('18:00', 45), '19:30', 60), false);
  assert.equal(overlaps(occupiedSlots('18:00', 45), '19:00', 60), true);
  assert.equal(overlaps(occupiedSlots('18:00', 60), '19:30', 60), true);
  assert.equal(overlaps(occupiedSlots('18:00', 60), '20:00', 60), false);
  assert.equal(overlaps([], '18:00', 60), false);
});

test('shiftSlots moves a booking block to a new start and keeps its shape', async () => {
  const { shiftSlots } = await import('../lib/slots.js');
  assert.deepEqual(shiftSlots(['16:00','16:30','17:00','17:30'], '16:00', '16:00'), ['16:00','16:30','17:00','17:30']);
  assert.deepEqual(shiftSlots(['16:00','16:30','17:00','17:30'], '16:00', '09:30'), ['09:30','10:00','10:30','11:00']);
  assert.deepEqual(shiftSlots(['22:30','23:00','23:30'], '22:30', '23:00'), ['23:00','23:30']);
});
