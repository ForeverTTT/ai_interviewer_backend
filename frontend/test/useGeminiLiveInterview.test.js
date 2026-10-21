import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Exercise the actual hook's socket handlers with deterministic timers and a
// minimal hook dispatcher. No network, browser microphone or new dependencies.
function mount() {
  const slots = []
  const effects = []
  const timers = new Map()
  const sockets = []
  const errors = []
  let cursor = 0
  let nextTimer = 0
  let dirty = false
  let current
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const useRef = value => { const i = cursor++; return slots[i] ||= { current: value } }
  const useState = initial => {
    const i = cursor++
    slots[i] ||= { value: initial }
    return [slots[i].value, value => {
      const next = typeof value === 'function' ? value(slots[i].value) : value
      if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true }
    }]
  }
  const useMemo = (fn, deps) => {
    const i = cursor++
    if (!slots[i] || !same(slots[i].deps, deps)) slots[i] = { value: fn(), deps }
    return slots[i].value
  }
  const useEffect = (fn, deps) => {
    const i = cursor++
    if (!slots[i] || !same(slots[i].deps, deps)) {
      const previous = slots[i]
      slots[i] = { deps, cleanup: previous?.cleanup }
      effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = fn() })
    }
  }
  class Socket {
    static OPEN = 1
    static CONNECTING = 0
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this) }
    send(value) { this.sent.push(value) }
    close() { this.readyState = 3; this.onclose?.({ code: 1000, reason: '' }) }
    open() { this.readyState = 1; this.onopen?.() }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }) }
  }
  const window = {
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id },
    clearTimeout: id => timers.delete(id),
  }
  const source = readFileSync(new URL('../src/hooks/useGeminiLiveInterview.js', import.meta.url), 'utf8')
    .split(/\r?\n/).filter(line => !line.startsWith('import ')).join('\n')
    .replace('export function useGeminiLiveInterview', 'function useGeminiLiveInterview')
  const hook = vm.runInNewContext(`${source}\nuseGeminiLiveInterview`, {
    useRef, useState, useMemo, useCallback: (fn, deps) => useMemo(() => fn, deps), useEffect, useLayoutEffect: useEffect,
    URL, WebSocket: Socket, window, navigator: { mediaDevices: {} },
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } },
    getBackendBaseUrl: () => 'https://backend.example.com',
  })
  const onError = error => errors.push(error)
  const props = { enabled: true, config: { interviewId: 'interview' }, audioEnabled: true, onError }
  function render() {
    cursor = 0; dirty = false
    current = hook(props)
    effects.splice(0).forEach(fn => fn())
  }
  async function flush() {
    for (let i = 0; i < 8; i++) { await Promise.resolve(); if (dirty) render() }
  }
  render()
  return {
    sockets, errors, timers, flush, current: () => current,
    fire(ms) {
      const entry = [...timers].find(([, value]) => value.ms === ms)
      assert.ok(entry, `expected timer ${ms}ms`)
      timers.delete(entry[0]); entry[1].fn()
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

test('upstream closed notification clears connected state and reconnects once despite duplicate close', async () => {
  const f = mount()
  await f.flush()
  f.sockets[0].open()
  f.sockets[0].message({ type: 'ready' })
  await f.flush()
  assert.equal(f.current().connected, true)
  f.sockets[0].message({ type: 'closed', code: 'LIVE_UPSTREAM_CLOSED', reason: 'Session expired' })
  await f.flush()
  assert.equal(f.current().connected, false)
  assert.equal(f.errors.length, 1)
  assert.equal(f.errors[0].code, 'LIVE_UPSTREAM_CLOSED')
  f.fire(1000)
  await f.flush()
  assert.equal(f.sockets.length, 2)
  f.sockets[1].open()
  f.sockets[1].message({ type: 'ready' })
  await f.flush()
  assert.equal(f.current().connected, true)
  assert.equal(f.current().error, null)
  f.unmount()
})

test('normal-code unexpected closure retries, but ending interview cancels retries', async () => {
  const f = mount()
  await f.flush()
  f.sockets[0].open()
  f.sockets[0].message({ type: 'ready' })
  f.sockets[0].close()
  await f.flush()
  assert.equal(f.current().connected, false)
  f.current().disconnect()
  assert.equal([...f.timers.values()].some(x => x.ms === 1000), false)
  f.unmount()
})

test('policy rejection never retries and repeated short-lived failures stop after three retries', async () => {
  const rejected = mount()
  await rejected.flush()
  rejected.sockets[0].onclose({ code: 1008, reason: 'Interview is finalizing' })
  assert.equal([...rejected.timers.values()].some(x => x.ms === 1000), false)
  assert.equal(rejected.errors.at(-1).willRetry, false)
  rejected.unmount()
  const f = mount()
  await f.flush()
  for (const delay of [1000, 2000, 4000]) {
    const socket = f.sockets.at(-1)
    socket.open(); socket.message({ type: 'ready' }); socket.close()
    f.fire(delay)
    await f.flush()
  }
  f.sockets.at(-1).close()
  await f.flush()
  assert.equal(f.sockets.length, 4)
  assert.equal(f.timers.size, 0)
  assert.deepEqual(f.errors.map(error => error.willRetry), [true, true, true, false])
  f.unmount()
})

test('nonfatal persistence errors preserve the working voice connection and expose the exact code', async () => {
  const f = mount()
  await f.flush()
  f.sockets[0].open(); f.sockets[0].message({ type: 'ready' })
  f.sockets[0].message({ type: 'error', code: 'LIVE_PERSIST_FAILED', fatal: false, message: 'Save failed' })
  await f.flush()
  assert.equal(f.current().connected, true)
  assert.equal(f.errors.at(-1).code, 'LIVE_PERSIST_FAILED')
  assert.equal([...f.timers.values()].some(x => x.ms === 1000), false)
  f.unmount()
})
