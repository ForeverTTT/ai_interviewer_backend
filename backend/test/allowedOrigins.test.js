import test from 'node:test'
import assert from 'node:assert/strict'
import { getAllowedOrigins, parseFrontendOrigins } from '../src/lib/allowedOrigins.js'

test('parseFrontendOrigins splits a comma-separated list and trims trailing slashes', () => {
  assert.deepEqual(
    parseFrontendOrigins(' https://global.flowlab-career.com/ , https://aiinterviewer-491711-7b1cf.web.app,'),
    ['https://global.flowlab-career.com', 'https://aiinterviewer-491711-7b1cf.web.app'],
  )
})

test('parseFrontendOrigins defaults to the local dev origin', () => {
  assert.deepEqual(parseFrontendOrigins(undefined), ['http://localhost:3000'])
})

test('getAllowedOrigins includes local origins without duplicates', () => {
  const origins = getAllowedOrigins('https://global.flowlab-career.com,http://localhost:3000')
  assert.equal(origins[0], 'https://global.flowlab-career.com')
  assert.ok(origins.includes('http://localhost:5173'))
  assert.equal(origins.filter((origin) => origin === 'http://localhost:3000').length, 1)
})
