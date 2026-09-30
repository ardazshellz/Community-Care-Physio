export const SLOT_BUFFER_MINS = 45;

export function durationMins(appointment) {
  const map = {
    'Initial Assessment':60,'Standard Session':45,'Extended Session':60,
    'Starter Programme':60,'Full Programme':60,
    'Block of 4 Sessions':45,'Block of 6 Sessions':45
  };
  return Object.hasOwn(map, appointment) ? map[appointment] : 60;
}

export function occupiedSlots(time, durationMins) {
  const [h, m] = time.split(':').map(Number);
  const startMins = h * 60 + m;
  const blocked = [];
  for (let t = 0; t < durationMins + SLOT_BUFFER_MINS; t += 30) {
    const slotMins = startMins + t;
    if (slotMins >= 24 * 60) break;
    blocked.push(`${String(Math.floor(slotMins / 60)).padStart(2,'0')}:${String(slotMins % 60).padStart(2,'0')}`);
  }
  return blocked;
}

export function overlaps(dateTimesTaken, time, durationMins) {
  const taken = dateTimesTaken instanceof Set ? dateTimesTaken : new Set(dateTimesTaken);
  return occupiedSlots(time, durationMins).some(slot => taken.has(slot));
}
