// ═══════════════════════════════════════════════════════════════════════════
// nautical.test.js — NauticalParser tests
// Run from repo root: node tests/nautical.test.js
// ═══════════════════════════════════════════════════════════════════════════

import { NauticalParser } from '../core/NauticalParser.js';
const STATES = { TRUE: '/', FALSE: '\\', UNCERTAIN: '|' };

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓  ${name}`); passed++; }
    catch (err) { console.log(`  ✗  ${name}\n     ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('\n── NauticalParser Tests ──────────────────────────────────');

const p = new NauticalParser();

test('parse() known token !:.', () => {
    const r = p.parse('!:.');
    assert(r?.alias === 'execute.default', `alias: ${r?.alias}`);
});

test('parse() returns null for unknown token', () => {
    assert(p.parse('???') === null, 'should be null');
});

test('parse() all 17 core tokens', () => {
    const tokens = ['!:.','.:!','::!','.!::','.:!:','::!.','!:..',':.^','!.^','!:>','.:>','!::.','.:!.','~!','~.','~:','*!:.'];
    const ok = tokens.filter(t => p.parse(t) !== null).length;
    assert(ok === 17, `${ok}/17 parsed`);
});

test('validate() valid token', () => {
    const { valid } = p.validate(':.^');
    assert(valid, 'should be valid');
});

test('validate() invalid token', () => {
    const { valid } = p.validate('xyz');
    assert(!valid, 'should be invalid');
});

test('parseLine() plain token + operand', () => {
    const r = p.parseLine('!:. some_target');
    assert(r?.token === '!:.', `token: ${r?.token}`);
    assert(r?.operand === 'some_target', `operand: ${r?.operand}`);
});

test('parseLine() single arbiter [MAX]', () => {
    const r = p.parseLine('[MAX] !:. target');
    assert(r?.from === 'MAX', `from: ${r?.from}`);
});

test('parseLine() directional [MAX]→[SOMA]', () => {
    const r = p.parseLine('[MAX]→[SOMA] ::!. config');
    assert(r?.from === 'MAX',  `from: ${r?.from}`);
    assert(r?.to   === 'SOMA', `to: ${r?.to}`);
});

test('parseLine() epistemic / prefix', () => {
    const r = p.parseLine('[SOMA] / :.^ ctx');
    assert(r?.epistemicState === '/', `state: ${r?.epistemicState}`);
});

test('parseLine() epistemic | prefix', () => {
    const r = p.parseLine('[MAX] | !:. verify');
    assert(r?.epistemicState === '|', `state: ${r?.epistemicState}`);
});

test('parseLine() null for empty', () => {
    assert(p.parseLine('') === null);
    assert(p.parseLine('// comment') === null);
});

const SESSION = `
POSEIDON::0.1 REGISTRY::17 ARBITER::MAX VOYAGE::auth-rebuild-001

[MAX]→[SOMA] !:>focus.layer.auth
[SOMA]→[MAX] / :.^ auth_context
[MAX]→[SOMA] | !:. verify_token
[SOMA]→[MAX] ~. auth_context.expired
[SOMA]→[MAX] / ::!. token
`;

test('parseSession() extracts header', () => {
    const r = p.parseSession(SESSION);
    assert(r.header?.arbiter  === 'MAX',              `arbiter: ${r.header?.arbiter}`);
    assert(r.header?.voyageId === 'auth-rebuild-001', `voyage: ${r.header?.voyageId}`);
});

test('parseSession() parses messages', () => {
    const r = p.parseSession(SESSION);
    assert(r.messages.length >= 4, `got ${r.messages.length} messages`);
});

test('parseSession() identifies TRUE epistemic states', () => {
    const r = p.parseSession(SESSION);
    const trueLines = r.messages.filter(m => m.epistemicState === '/');
    assert(trueLines.length >= 2, `got ${trueLines.length} TRUE lines`);
});

console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────\n`);
if (failed > 0) process.exit(1);
