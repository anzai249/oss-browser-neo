import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useFileDrop } from '../src/composables/useFileDrop.js'

const child = {},
  sibling = {},
  outside = {}
const panel = { contains: (node) => [panel, child, sibling].includes(node) }
function event(overrides = {}) {
  return {
    currentTarget: panel,
    target: child,
    relatedTarget: null,
    dataTransfer: { types: ['Files'], files: [], dropEffect: 'none' },
    preventDefault() {
      this.prevented = true
    },
    ...overrides,
  }
}

test('leaving from a nested file row clears the overlay', () => {
  const drop = useFileDrop()
  drop.enter(event())
  assert.equal(drop.dragging.value, true)
  drop.leave(event({ relatedTarget: outside }))
  assert.equal(drop.dragging.value, false)
})

test('nested transitions do not flicker, including WebKit null relatedTarget', () => {
  for (const relatedTarget of [sibling, null]) {
    const drop = useFileDrop()
    drop.enter(event())
    drop.enter(event({ target: sibling }))
    drop.leave(event({ relatedTarget }))
    assert.equal(drop.dragging.value, true)
    drop.leave(event({ target: sibling }))
    assert.equal(drop.dragging.value, false)
    // Extra leave events cannot corrupt the next drag's depth.
    drop.leave(event())
    drop.enter(event())
    drop.leave(event())
    assert.equal(drop.dragging.value, false)
  }
})

test('dragover fallback and moving outside the panel clear stale state', () => {
  const drop = useFileDrop({ panel: () => panel })
  const target = new EventTarget()
  const cleanup = drop.bind(target)
  drop.over(event())
  assert.equal(drop.dragging.value, true)
  drop.leave(event())
  assert.equal(drop.dragging.value, false)
  drop.enter(event())
  const over = new Event('dragover')
  Object.defineProperty(over, 'target', { value: outside })
  target.dispatchEvent(over)
  assert.equal(drop.dragging.value, false)
  cleanup()
})

test('only enabled file drags show the overlay, and drop preserves file payload', () => {
  let enabled = true
  const drop = useFileDrop({ enabled: () => enabled })
  drop.enter(event({ dataTransfer: { types: ['text/plain'] } }))
  assert.equal(drop.dragging.value, false)
  const file = new File(['test'], 'test.txt')
  drop.enter(event())
  const incoming = event({ dataTransfer: { types: ['Files'], files: [file] } })
  assert.deepEqual(drop.drop(incoming), [file])
  assert.equal(incoming.prevented, true)
  assert.equal(drop.dragging.value, false)
  enabled = false
  drop.enter(event())
  drop.over(event())
  assert.equal(drop.dragging.value, false)
  assert.deepEqual(drop.drop(incoming), [])
})

test('cancellation, window exit, outside drops and lifecycle cleanup reset drag state', () => {
  const drop = useFileDrop()
  const target = new EventTarget()
  const cleanup = drop.bind(target)
  for (const type of ['blur', 'dragend', 'pointermove', 'keydown', 'drop']) {
    drop.enter(event())
    const e = new Event(type, { cancelable: true })
    if (type === 'keydown') Object.defineProperty(e, 'key', { value: 'Escape' })
    if (type === 'drop') Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'] } })
    target.dispatchEvent(e)
    assert.equal(drop.dragging.value, false, type)
    if (type === 'drop') assert.equal(e.defaultPrevented, true)
  }
  drop.enter(event())
  cleanup()
  assert.equal(drop.dragging.value, false)
  drop.enter(event())
  target.dispatchEvent(new Event('blur'))
  assert.equal(drop.dragging.value, true, 'cleanup removes listeners')
})
