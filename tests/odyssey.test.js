// ═══════════════════════════════════════════════════════════════════════════
// odyssey.test.js — Navigator + persistence tests
// Run from repo root: node tests/odyssey.test.js
// ═══════════════════════════════════════════════════════════════════════════

import { Odyssey, STATUS } from '../core/Odyssey.js';
import fs                  from 'fs';
import path                from 'path';

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓  ${name}`); passed++; }
    catch (err) { console.log(`  ✗  ${name}\n     ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// Clean slate
const VID = 'test-voyage-001';
const vDir = path.resolve(process.cwd(), 'voyages', VID);
if (fs.existsSync(vDir)) fs.rmSync(vDir, { recursive: true });

console.log('\n── Odyssey Navigator Tests ───────────────────────────────');

const o = new Odyssey();

test('define() creates a voyage with milestones', () => {
    const v = o.define(VID, 'Test Voyage', [
        { id: 'm1', title: 'First',  deps: [] },
        { id: 'm2', title: 'Second', deps: ['m1'] },
        { id: 'm3', title: 'Third',  deps: ['m1'] },
        { id: 'm4', title: 'Final',  deps: ['m2', 'm3'] },
    ]);
    assert(v.milestones.length === 4, 'expected 4 milestones');
    assert(v.milestones[0].status === STATUS.DOCKED, 'should start docked');
});

test('voyage.json written to disk', () => {
    assert(fs.existsSync(path.join(vDir, 'voyage.json')), 'voyage.json missing');
});

test('getUnblocked() returns only m1 initially', () => {
    const u = o.getUnblocked(VID);
    assert(u.length === 1 && u[0].id === 'm1', `expected [m1], got ${u.map(m=>m.id)}`);
});

test('advance() docked→sailing returns state |', () => {
    const r = o.advance(VID, 'm1', {});
    assert(r.state === '|', `expected |, got ${r.state}`);
});

test('advance() sailing→arrived returns state /', () => {
    const r = o.advance(VID, 'm1', { success: true, output: 'done', verificationPassed: true });
    assert(r.state === '/', `expected /, got ${r.state}`);
});

test('checkpoint saved after arrival', () => {
    const cps = fs.readdirSync(path.join(vDir, 'checkpoints'));
    assert(cps.length >= 1, 'no checkpoint saved');
});

test('log.ndjson exists and has entries', () => {
    const lf = path.join(vDir, 'log.ndjson');
    assert(fs.existsSync(lf), 'log.ndjson missing');
    const lines = fs.readFileSync(lf, 'utf8').trim().split('\n');
    assert(lines.length >= 3, `expected ≥3 entries, got ${lines.length}`);
});

test('m2 and m3 unblocked after m1 arrived', () => {
    const ids = o.getUnblocked(VID).map(m => m.id).sort();
    assert(ids.includes('m2') && ids.includes('m3'), `expected m2+m3, got ${ids}`);
});

test('blocked milestone returns state \\', () => {
    const r = o.advance(VID, 'm4', {});
    assert(r.state === '\\', `expected \\, got ${r.state}`);
});

test('failed advance returns state \\ and triggers checkpoint restore', () => {
    o.advance(VID, 'm2', {});
    const r = o.advance(VID, 'm2', { success: false });
    assert(r.state === '\\', `expected \\, got ${r.state}`);
});

test('summary() reports correct arrived/failed', () => {
    const s = o.summary(VID);
    assert(s.arrived.includes('m1'), 'm1 should be arrived');
    assert(s.failed.includes('m2'),  'm2 should be failed');
    assert(s.progress === '1/4',     `progress: ${s.progress}`);
});

test('contextDump() is ≤120 chars and contains all milestones', () => {
    const d = o.contextDump(VID);
    assert(d.length <= 120,          `too long: ${d.length}`);
    assert(d.startsWith('VOYAGE:'),  'should start with VOYAGE:');
    assert(d.includes('m1') && d.includes('m4'), 'missing milestones');
    console.log(`     dump: ${d}`);
});

test('load() restores voyage in a fresh Odyssey instance', async () => {
    const fresh  = new Odyssey();
    const loaded = await fresh.load(VID);
    assert(loaded !== null, 'load() returned null');
    assert(loaded.milestones.find(m => m.id === 'm1')?.status === STATUS.ARRIVED,
        'm1 should still be arrived after reload');
});

console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────\n`);
if (failed > 0) process.exit(1);
