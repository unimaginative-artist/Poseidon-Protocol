// ═══════════════════════════════════════════════════════════════════════════
// integration.test.js — end-to-end: Poseidon + Trident + Odyssey + Nautical
// Run from repo root: node tests/integration.test.js
// ═══════════════════════════════════════════════════════════════════════════

import { Poseidon }        from '../core/Poseidon.js';
import { Trident }         from '../core/Trident.js';
import { Odyssey, STATUS } from '../core/Odyssey.js';
import { NauticalParser }  from '../core/NauticalParser.js';
import { NauticalEncoder } from '../core/NauticalEncoder.js';
import os                  from 'os';
import path                from 'path';
import fs                  from 'fs';

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓  ${name}`); passed++; }
    catch (err) { console.log(`  ✗  ${name}\n     ${err.message}`); failed++; }
}
async function testAsync(name, fn) {
    try { await fn(); console.log(`  ✓  ${name}`); passed++; }
    catch (err) { console.log(`  ✗  ${name}\n     ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

const TEMP = path.join(os.tmpdir(), `poseidon-integration-${Date.now()}`);
fs.mkdirSync(TEMP, { recursive: true });

console.log('\n── Integration Tests ─────────────────────────────────────');

// ── 1. Poseidon epistemic system ──────────────────────────────────────────

console.log('\n  [Poseidon]');

await testAsync('filter() assigns ternary state from confidence', async () => {
    const p = new Poseidon({ threshold: 0.75 });
    const high = await p.filter('claim', 0.9);
    const low  = await p.filter('claim', 0.1);
    const mid  = await p.filter('claim', 0.5);
    assert(high.state === 'TRUE',      `high: ${high.state}`);
    assert(low.state  === 'FALSE',     `low: ${low.state}`);
    assert(mid.state  === 'UNCERTAIN', `mid: ${mid.state}`);
});

await testAsync('verify() requires falsification test for TRUE', async () => {
    const p = new Poseidon();
    const noTest = await p.verify('claim', {});
    assert(noTest.state === 'UNCERTAIN', 'no test → UNCERTAIN');

    const failed = await p.verify('claim', { falsificationTest: 'check X', testResult: false });
    assert(failed.state === 'FALSE', 'failed test → FALSE');

    const passed2 = await p.verify('claim', { falsificationTest: 'check X', testResult: true });
    assert(passed2.state === 'TRUE', 'passed test → TRUE');
});

// ── 2. Trident → Odyssey pipeline ────────────────────────────────────────

console.log('\n  [Trident → Odyssey]');

const mockArchitecture = {
    objective:  { goal: 'build-auth-system', metrics: ['latency < 200ms'] },
    subsystems: [
        { name: 'TokenStore',   role: 'Persist and retrieve auth tokens' },
        { name: 'Validator',    role: 'Validate incoming tokens against store' },
        { name: 'APIGateway',   role: 'Route authenticated requests' },
    ],
    interfaces: [
        { from: 'TokenStore', to: 'Validator',  type: 'read' },
        { from: 'Validator',  to: 'APIGateway', type: 'signal' },
    ],
    verificationGates: [
        { claim: 'TokenStore works',   falsificationTest: 'Write token, read it back — does it match?', evidence: 'token === stored' },
        { claim: 'Validator works',    falsificationTest: 'Send invalid token — does it return 401?',   evidence: 'status === 401' },
        { claim: 'APIGateway routes',  falsificationTest: 'Send valid token — does request pass?',      evidence: 'status === 200' },
    ],
    synthesis: 'Three-layer auth system'
};

test('toVoyage() converts architecture to voyage DAG', () => {
    const trident = new Trident();
    const voyage  = trident.toVoyage(mockArchitecture);
    assert(voyage.voyageId === 'build-auth-system',   `voyageId: ${voyage.voyageId}`);
    assert(voyage.milestones.length === 3,             `milestones: ${voyage.milestones.length}`);
    const validator = voyage.milestones.find(m => m.id === 'validator');
    assert(validator.deps.includes('tokenstore'),      `validator deps: ${validator.deps}`);
    assert(validator.falsificationTest !== null,       'falsificationTest should be set');
});

test('toVoyage() milestones have correct dep chain', () => {
    const trident = new Trident();
    const voyage  = trident.toVoyage(mockArchitecture);
    const gateway = voyage.milestones.find(m => m.id === 'apigateway');
    assert(gateway.deps.includes('validator'), `gateway deps: ${gateway.deps}`);
});

// ── 3. Odyssey execute() with Poseidon verification ───────────────────────

console.log('\n  [Odyssey + Poseidon verification]');

const odyssey = new Odyssey({ voyagesDir: TEMP });

test('define() voyage from trident.toVoyage() output', () => {
    const trident = new Trident();
    const plan    = trident.toVoyage(mockArchitecture);
    const voyage  = odyssey.define(plan.voyageId, plan.title, plan.milestones);
    assert(voyage.milestones.length === 3, `milestones: ${voyage.milestones.length}`);
});

await testAsync('execute() advances milestone with verified TRUE', async () => {
    const result = await odyssey.execute('build-auth-system', 'tokenstore', async () => ({
        output:            { tokensStored: 42 },
        falsificationTest: 'Write token, read it back — does it match?',
        testResult:        true,
    }));
    assert(result.state === '/', `expected /, got ${result.state}`);
    assert(result.value.status === STATUS.ARRIVED, `status: ${result.value.status}`);
    assert(result.value.verification?.state === 'TRUE', `verification: ${result.value.verification?.state}`);
});

await testAsync('execute() advances milestone without falsification test → UNCERTAIN arrival', async () => {
    const result = await odyssey.execute('build-auth-system', 'validator', async () => ({
        output: { validated: true },
        // no falsificationTest — Poseidon returns UNCERTAIN
    }));
    // UNCERTAIN verification still allows arrival (warns but doesn't block)
    assert(result.value.status === STATUS.ARRIVED, `status: ${result.value.status}`);
    assert(result.value.verification?.state === 'UNCERTAIN', `verification: ${result.value.verification?.state}`);
});

await testAsync('execute() fails milestone when testResult is false', async () => {
    const result = await odyssey.execute('build-auth-system', 'apigateway', async () => ({
        output:            { routed: false },
        falsificationTest: 'Send valid token — does request pass?',
        testResult:        false,  // verification fails
    }));
    assert(result.state === '\\', `expected \\, got ${result.state}`);
    assert(result.value.status === STATUS.FAILED, `status: ${result.value.status}`);
});

// ── 4. NauticalEncoder + NauticalParser round-trip ────────────────────────

console.log('\n  [NauticalEncoder ↔ NauticalParser round-trip]');

const encoder = new NauticalEncoder();
const parser  = new NauticalParser();

test('encoder.header() produces parseable header', () => {
    const line   = encoder.header({ version: '0.1', arbiter: 'MAX', voyageId: 'build-auth-system' });
    const result = parser.parseSession(line);
    assert(result.header?.arbiter  === 'MAX',               `arbiter: ${result.header?.arbiter}`);
    assert(result.header?.voyageId === 'build-auth-system', `voyage: ${result.header?.voyageId}`);
});

test('encoder.message() produces parseable message', () => {
    const line   = encoder.message({ from: 'MAX', to: 'SOMA', state: '/', token: ':.^', operand: 'ctx' });
    const result = parser.parseLine(line);
    assert(result.from  === 'MAX',  `from: ${result.from}`);
    assert(result.to    === 'SOMA', `to: ${result.to}`);
    assert(result.token === ':.^',  `token: ${result.token}`);
    assert(result.epistemicState === '/', `state: ${result.epistemicState}`);
});

test('encoder.messageByAlias() resolves alias to token', () => {
    const line = encoder.messageByAlias({ from: 'MAX', alias: 'mem.save', operand: 'auth_ctx' });
    assert(line.includes(':.^'), `expected :.^ in: ${line}`);
});

test('encoder.session() produces full parseable session', () => {
    const text = encoder.session({
        header: { arbiter: 'MAX', voyageId: 'build-auth-system' },
        messages: [
            { from: 'MAX', to: 'SOMA', state: '/',  token: '!:.', operand: 'bootstrap' },
            { from: 'SOMA', to: 'MAX', state: '|',  token: ':.^', operand: 'save_ctx' },
            { from: 'MAX', to: 'SOMA', state: '\\', token: '~.',  operand: 'fallback' },
        ]
    });
    const result = parser.parseSession(text);
    assert(result.header !== null,           'header missing');
    assert(result.messages.length === 3,     `messages: ${result.messages.length}`);
    assert(result.messages[2].epistemicState === '\\', `last state: ${result.messages[2].epistemicState}`);
});

// ── 5. Index exports everything ────────────────────────────────────────────

console.log('\n  [Index exports]');

await testAsync('index.js exports all core classes', async () => {
    const mod = await import('../index.js');
    assert(typeof mod.Poseidon        === 'function', 'Poseidon missing');
    assert(typeof mod.Trident         === 'function', 'Trident missing');
    assert(typeof mod.Odyssey         === 'function', 'Odyssey missing');
    assert(typeof mod.NauticalParser  === 'function', 'NauticalParser missing');
    assert(typeof mod.NauticalEncoder === 'function', 'NauticalEncoder missing');
    assert(typeof mod.RegistryLoader  === 'function', 'RegistryLoader missing');
    assert(typeof mod.STATUS          === 'object',   'STATUS missing');
});

console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────\n`);
if (failed > 0) process.exit(1);
