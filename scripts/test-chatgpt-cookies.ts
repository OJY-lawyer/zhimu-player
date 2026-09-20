import assert from 'node:assert/strict'
import { CHATGPT_COOKIE_LIMITS, parseChatGptCookieImport, parseChatGptCookies } from '../src/main/chatgptCookies'

const now = 1_800_000_000
const base = { domain: 'chatgpt.com', name: 'fixture-session', value: 'synthetic-value', path: '/', secure: true, httpOnly: true, session: true, hostOnly: true }
const parse = (entries: unknown[]) => parseChatGptCookieImport(JSON.stringify(entries), now)
const one = parse([base]).cookies[0]
assert.equal(one.url, 'https://chatgpt.com/')
assert.equal(one.domain, undefined)
assert.equal(one.expires, undefined)
assert.equal(one.httpOnly, true)
assert.equal(one.secure, true)
for (const wrapper of [JSON.stringify([base]), JSON.stringify({ cookies: [base] }),
  JSON.stringify(JSON.stringify([base])), '```json\n' + JSON.stringify([base]) + '\n```',
  JSON.stringify('```json\n' + JSON.stringify({ cookies: [base] }) + '\n```'), '\uFEFF' + JSON.stringify([base])]) {
  assert.equal(parseChatGptCookies(wrapper).length, 1)
}
const scopes = parse([
  { ...base, domain: '.chatgpt.com', hostOnly: false },
  { ...base, domain: 'auth.chatgpt.com', hostOnly: true },
  { ...base, domain: '.chatgpt.com', hostOnly: undefined, name: '__Host-fixture' },
]).cookies
assert.equal(scopes[0].domain, '.chatgpt.com')
assert.equal(scopes[0].url, undefined)
assert.equal(scopes[1].url, 'https://auth.chatgpt.com/')
assert.equal(scopes[2].url, 'https://chatgpt.com/')
assert.equal(scopes[2].domain, undefined, '__Host- must never carry a Domain attribute')
assert.equal(parse([{ ...base, name: '__Host-fixture', hostOnly: false }]).cookies.length, 0)
assert.equal(parse([{ ...base, name: '__Host-fixture', path: '/sub' }]).cookies.length, 0)
assert.equal(parse([{ ...base, name: '__Host-fixture', secure: false }]).cookies.length, 0)
assert.equal(parse([{ ...base, name: '__Secure-fixture', secure: false }]).cookies.length, 0)
assert.equal(parse([{ ...base, name: '__Host-Http-fixture', httpOnly: false }]).cookies.length, 0)

const foreign = parse(['openai.com', 'chatgpt.com.evil.example', 'evilchatgpt.com', 'example.com'].map(domain => ({ ...base, domain })))
assert.equal(foreign.cookies.length, 0)
assert.equal(foreign.skipped.unrelatedDomain, 4)
for (const domain of ['https://chatgpt.com', 'chatgpt.com:443', 'chatgpt.com.', '..chatgpt.com', 'chatgpt.com/evil', 'bad_label.chatgpt.com', 'chatgpt.com\r\n', '知幕.chatgpt.com']) {
  assert.equal(parse([{ ...base, domain }]).cookies.length, 0)
}
for (const [input, output] of [['strict', 'Strict'], ['lax', 'Lax'], ['none', 'None'], ['no_restriction', 'None'], ['Strict', 'Strict']]) {
  assert.equal(parse([{ ...base, sameSite: input }]).cookies[0].sameSite, output)
}
assert.equal(parse([{ ...base, sameSite: 'unspecified' }]).cookies[0].sameSite, undefined)
assert.equal(parse([{ ...base, sameSite: 'none', secure: false }]).cookies.length, 0)
assert.equal(parse([{ ...base, sameSite: 'unexpected' }]).cookies.length, 0)
assert.equal(parse([{ ...base, secure: 'false' }]).cookies.length, 0)
assert.equal(parse([{ ...base, hostOnly: 'true' }]).cookies.length, 0)
assert.equal(parse([{ ...base, partitionKey: { topLevelSite: 'https://other.example' } }]).cookies.length, 0)
assert.equal(parse([{ ...base, partitioned: true }]).cookies.length, 0)

const expiry = parse([
  { ...base, name: 'future', session: false, expirationDate: now + 5000.5 },
  { ...base, name: 'past', session: false, expirationDate: now - 1 },
  { ...base, name: 'boundary', session: false, expirationDate: now },
  { ...base, name: 'session', expirationDate: 0 },
  { ...base, name: 'cdp-session', session: undefined, expires: -1 },
  { ...base, name: 'bad-ms', session: false, expirationDate: (now + 5000) * 1000 },
  { ...base, name: 'bad-string', session: false, expirationDate: String(now + 5000) },
  { ...base, name: 'missing', session: false },
])
assert.deepEqual(expiry.cookies.map(cookie => cookie.name), ['future', 'session', 'cdp-session'])
assert.equal(expiry.cookies[0].expires, now + 5000.5)
assert.equal(expiry.cookies[1].expires, undefined)
assert.equal(expiry.cookies[2].expires, undefined)
assert.equal(expiry.skipped.expired, 2)
assert.equal(expiry.skipped.invalid, 3)

for (const name of ['', 'has space', 'name=value', 'name;other', 'line\nbreak', '中文', 'a'.repeat(CHATGPT_COOKIE_LIMITS.nameBytes + 1)]) {
  assert.equal(parse([{ ...base, name }]).cookies.length, 0)
}
for (const value of ['raw\nvalue', 'x;y', 'x,y', 'space value', 'x\\y', 'x"y', '中文', 'a'.repeat(CHATGPT_COOKIE_LIMITS.valueBytes + 1)]) {
  assert.equal(parse([{ ...base, value }]).cookies.length, 0)
}
for (const value of ['', 'a=b', 'safe%20encoded', 'fixture._-~+/=', '"quoted-value"']) assert.equal(parse([{ ...base, value }]).cookies[0].value, value)
for (const cookiePath of ['relative', '/bad;path', '/bad\npath', '/' + 'a'.repeat(CHATGPT_COOKIE_LIMITS.pathBytes)]) {
  assert.equal(parse([{ ...base, path: cookiePath }]).cookies.length, 0)
}
const duplicate = parse([base, { ...base, value: 'later-synthetic-value' }, { ...base, domain: 'sub.chatgpt.com' }])
assert.equal(duplicate.cookies.length, 2)
assert.equal(duplicate.cookies[0].value, 'later-synthetic-value')
assert.equal(duplicate.skipped.duplicate, 1)
for (const raw of ['{"sensitive-fixture":', 'not-json synthetic-private-text', '{}', 'null', JSON.stringify('not-json synthetic-private-text'),
  ' '.repeat(CHATGPT_COOKIE_LIMITS.inputBytes + 1), JSON.stringify(Array(CHATGPT_COOKIE_LIMITS.entries + 1).fill(base))]) {
  assert.throws(() => parseChatGptCookies(raw), error => {
    assert(error instanceof Error)
    assert(!/sensitive-fixture|synthetic-private-text|synthetic-value|SyntaxError|Unexpected token/.test(error.message))
    return true
  })
}
assert.deepEqual(parse([null, 1, [], false]).skipped, { unrelatedDomain: 0, invalid: 4, expired: 0, duplicate: 0 })
console.log('chatgpt-cookies: bounded/redacted parsing, wrappers, site filtering, host-only prefixes, SameSite and expiry passed; synthetic cookies only')
