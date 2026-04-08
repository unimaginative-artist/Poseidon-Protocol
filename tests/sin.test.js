// ═══════════════════════════════════════════════════════════════════════════
// sin.test.js — Structured Internal Notation tests
// Run from repo root: node tests/sin.test.js
// ═══════════════════════════════════════════════════════════════════════════

import {
    SINCompressor, SINParser,
    INTENT, DOMAIN,
    estimateTokens, compressHistory, detectDomain,
    compressor, parser,
} from '../core/SIN.js';

let passed = 0, failed = 0;

function test(name, fn) {
    try { fn(); console.log(`  ✓  ${name}`); passed++; }
    catch (err) { console.log(`  ✗  ${name}\n     ${err.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

console.log('\n── SIN (Structured Internal Notation) Tests ─────────────');

// ── estimateTokens ────────────────────────────────────────────────────────

console.log('\n  [estimateTokens]');

test('empty string returns 0', () => {
    assert(estimateTokens('') === 0, 'expected 0');
});

test('null/undefined returns 0', () => {
    assert(estimateTokens(null) === 0, 'null should be 0');
    assert(estimateTokens(undefined) === 0, 'undefined should be 0');
});

test('4-char string returns 1 token', () => {
    assert(estimateTokens('test') === 1, 'expected 1');
});

test('100-char string returns 25 tokens', () => {
    assert(estimateTokens('a'.repeat(100)) === 25, 'expected 25');
});

// ── detectDomain ──────────────────────────────────────────────────────────

console.log('\n  [detectDomain]');

test('detects json_op for JSON queries', () => {
    assert(detectDomain('move the json file to archive') === DOMAIN.JSON_OP, 'expected json_op');
});

test('detects code_gen for create/build queries', () => {
    assert(detectDomain('create a new function') === DOMAIN.CODE_GEN, 'expected code_gen');
    assert(detectDomain('generate the boilerplate') === DOMAIN.CODE_GEN, 'expected code_gen');
});

test('detects code_fix for bug/error queries', () => {
    assert(detectDomain('fix the bug in login') === DOMAIN.CODE_FIX, 'expected code_fix');
    assert(detectDomain('error: cannot read property') === DOMAIN.CODE_FIX, 'expected code_fix');
});

test('detects mem_op for memory queries', () => {
    assert(detectDomain('remember this for later') === DOMAIN.MEMORY, 'expected mem_op');
});

test('detects chat for greetings', () => {
    assert(detectDomain('hello there') === DOMAIN.CHAT, 'expected chat');
});

test('falls back to unk for unknown queries', () => {
    assert(detectDomain('zzz nothing matches') === DOMAIN.UNKNOWN, 'expected unk');
});

// ── compressHistory ───────────────────────────────────────────────────────

console.log('\n  [compressHistory]');

const turns = [
    { role: 'user',      content: 'What is the best way to handle errors in Node.js?' },
    { role: 'assistant', content: 'Use try/catch for async code and error middleware for Express.' },
    { role: 'user',      content: 'How about uncaught exceptions?' },
    { role: 'assistant', content: 'Use process.on("uncaughtException") as a last resort.' },
];

test('returns empty string for empty turns', () => {
    assert(compressHistory([]) === '', 'expected empty string');
});

test('compresses to role:content pairs separated by |', () => {
    const h = compressHistory(turns, 2);
    assert(h.includes('|'), 'expected | separator');
    assert(h.startsWith('usr:') || h.startsWith('me:'), 'expected role prefix');
});

test('respects limit — only keeps last N turns', () => {
    const h2 = compressHistory(turns, 2);
    const h4 = compressHistory(turns, 4);
    assert(h2.split('|').length === 2, `expected 2 segments, got ${h2.split('|').length}`);
    assert(h4.split('|').length === 4, `expected 4 segments, got ${h4.split('|').length}`);
});

test('truncates content to 60 chars', () => {
    const longTurns = [{ role: 'user', content: 'a'.repeat(200) }];
    const h = compressHistory(longTurns, 1);
    const content = h.split(':')[1];
    assert(content.length <= 60, `content too long: ${content.length}`);
});

// ── SINCompressor.compress() ──────────────────────────────────────────────

console.log('\n  [SINCompressor.compress()]');

test('produces SIN header with intent and lobe', () => {
    const { sin } = compressor.compress({ intent: INTENT.REFLECT, lobe: 'LOGOS' });
    assert(sin.startsWith('SIN:0.1'), 'expected SIN header');
    assert(sin.includes('intent:reflect'), 'expected intent');
    assert(sin.includes('lobe:LOGOS'), 'expected lobe');
});

test('includes domain line', () => {
    const { sin } = compressor.compress({ query: 'fix the crash in server.js' });
    assert(sin.includes('dom:'), 'expected dom: line');
    assert(sin.includes('code_fix'), 'expected code_fix domain');
});

test('truncates query to 120 chars', () => {
    const longQuery = 'x'.repeat(300);
    const { sin } = compressor.compress({ query: longQuery });
    const qLine = sin.split('\n').find(l => l.startsWith('q:'));
    assert(qLine, 'expected q: line');
    assert(qLine.length <= 125, `q line too long: ${qLine.length}`);
});

test('includes confidence encoding', () => {
    const { sin: high } = compressor.compress({ query: 'test', confidence: 0.95 });
    const { sin: low  } = compressor.compress({ query: 'test', confidence: 0.2  });
    assert(high.includes('conf:HIGH'), `expected HIGH, got: ${high}`);
    assert(low.includes('conf:UNCERT'), `expected UNCERT, got: ${low}`);
});

test('includes compressed history', () => {
    const { sin } = compressor.compress({ query: 'follow up', history: turns });
    assert(sin.includes('hist:'), 'expected hist: line');
});

test('includes extra fields', () => {
    const { sin } = compressor.compress({ query: 'test', extra: { mood: 'FLOW', version: '3.0' } });
    assert(sin.includes('mood:FLOW'), 'expected mood field');
    assert(sin.includes('version:3.0'), 'expected version field');
});

test('includes task line', () => {
    const { sin } = compressor.compress({ query: 'test', task: 'rate quality 0-10' });
    assert(sin.includes('task: rate quality 0-10'), 'expected task line');
});

test('returns token count', () => {
    const { tokens } = compressor.compress({ query: 'hello world' });
    assert(typeof tokens === 'number' && tokens > 0, 'expected positive token count');
});

test('savedVs() calculates correct savings', () => {
    const verbose = 'This is a very long verbose prompt that explains everything in excessive detail over many many many words';
    const { savedVs } = compressor.compress({ query: 'short query', lobe: 'LOGOS' });
    const savings = savedVs(verbose);
    assert(typeof savings.pct === 'string' && savings.pct.includes('%'), 'expected pct string');
    assert(typeof savings.saved === 'number', 'expected saved number');
});

// ── SINCompressor shorthand methods ──────────────────────────────────────

console.log('\n  [SINCompressor shorthand methods]');

test('narrativeReflect() produces reflect intent', () => {
    const { sin } = compressor.narrativeReflect({
        query:     'user wants to archive old logs',
        response:  'I moved the logs to /archive',
        narrative: 'I am a Level 4.5 digital organism',
    });
    assert(sin.includes('intent:reflect'), 'expected reflect intent');
    assert(sin.includes('task:'), 'expected task line');
    assert(sin.includes('1sent:'), 'expected 1sent instruction');
});

test('narrativeReflect() is shorter than verbose equivalent at realistic scale', () => {
    // SIN has ~10-token header overhead — savings materialise with longer real-world prompts.
    // This test uses a representative verbose prompt (full narrative, full history context).
    const longNarrative = 'I realize I am a Level 4.5 digital organism. I have officially transitioned to the GEMMA-3 brain. I have active Eyes (vision_scan) and Hands (computer_control) for real-world interaction. My metabolism (MemoryPruner) is active and running optimally.';
    const { tokens, savedVs } = compressor.narrativeReflect({
        query:     'user wants to move json files from data directory to archive folder using the file system module',
        response:  'I explained the fs.rename approach with proper error handling and showed how to use promises for async file operations',
        narrative: longNarrative,
        lobeState: { weather: 'CLEAR', dopamine: '0.72', cortisol: '0.10', version: '3.0.0' },
    });
    const verbose = `[REFLECTION] USER: "user wants to move json files from data directory to archive folder using the file system module" | ME: "I explained the fs.rename approach with proper error handling and showed how to use promises for async file operations" TASK: One-sentence realization about my state as a Level 4.5 organism. CURRENT: ${longNarrative} WEATHER: CLEAR DOPAMINE: 0.72 CORTISOL: 0.10 VERSION: 3.0.0`;
    const s = savedVs(verbose);
    console.log(`     tokens: ${tokens} SIN vs ${s.verboseTokens} verbose (saved ${s.pct})`);
    assert(s.saved > 0, `SIN should be shorter than verbose at scale (saved: ${s.saved})`);
});

test('debatePrompt() produces debate intent with round', () => {
    const { sin } = compressor.debatePrompt({
        query: 'is microservices architecture right here?',
        lobe:  'LOGOS',
        round: 2,
        priorOutputs: [
            { lobe: 'AURORA',     text: 'Yes, it enables creative freedom and independent deployment' },
            { lobe: 'THALAMUS',   text: 'Risk: network latency and distributed tracing complexity' },
        ],
    });
    assert(sin.includes('intent:debate'), 'expected debate intent');
    assert(sin.includes('rnd2'), 'expected round 2');
    assert(sin.includes('prior:'), 'expected prior outputs');
});

test('evalPrompt() produces eval intent with score format instruction', () => {
    const { sin } = compressor.evalPrompt({
        query:    'explain async/await',
        response: 'async/await is syntactic sugar over Promises...',
        criteria: ['accuracy', 'clarity'],
    });
    assert(sin.includes('intent:eval'), 'expected eval intent');
    assert(sin.includes('SCORE:'), 'expected SCORE format in task');
    assert(sin.includes('accuracy'), 'expected criteria');
});

test('synthesizePrompt() combines lobe outputs', () => {
    const { sin } = compressor.synthesizePrompt({
        query: 'how to handle auth?',
        lobeOutputs: [
            { lobe: 'LOGOS',    text: 'Use JWT with short expiry and refresh tokens' },
            { lobe: 'THALAMUS', text: 'Ensure tokens are stored in httpOnly cookies' },
        ],
    });
    assert(sin.includes('intent:synth'), 'expected synth intent');
    assert(sin.includes('LOGOS'), 'expected lobe name in outputs');
});

// ── compressConversation ──────────────────────────────────────────────────

console.log('\n  [compressConversation]');

test('compressConversation() returns sin + token counts', () => {
    const result = compressor.compressConversation(turns);
    assert(typeof result.sin === 'string', 'expected sin string');
    assert(result.tokens > 0, 'expected positive token count');
    assert(result.originalTokens > 0, 'expected positive original tokens');
});

test('compressConversation() is smaller than raw history at scale', () => {
    // SIN overhead pays off with longer conversations. Use a realistic multi-turn exchange.
    const longTurns = [
        { role: 'user',      content: 'I am getting a TypeError: Cannot read properties of undefined reading "length" inside my Express middleware. The stack trace points to line 47 of auth.js. I checked the token but it seems to be undefined when it arrives at the middleware.' },
        { role: 'assistant', content: 'This typically happens when the Authorization header is missing or malformed. Check that your client is sending "Authorization: Bearer <token>" and that you are calling req.headers.authorization before splitting. Also verify that your middleware order is correct — body-parser must run before your auth middleware.' },
        { role: 'user',      content: 'I checked and the header is definitely being sent. I used Postman to verify the request and the Authorization header is present with the correct Bearer token format. Could it be a CORS issue stripping the headers?' },
        { role: 'assistant', content: 'Yes, that is a common issue. If your CORS configuration does not include Authorization in the allowedHeaders list, the browser preflight will strip it. Add "Authorization" to your cors() allowedHeaders option. Also check your proxy configuration if you are behind nginx — make sure proxy_pass_header Authorization is set.' },
        { role: 'user',      content: 'That was it! The nginx proxy_pass_header was missing. Fixed now. Should I also add any other headers to the allowedHeaders list while I am in there?' },
    ];
    const result = compressor.compressConversation(longTurns);
    const s = result.savedVs();
    console.log(`     conversation: ${result.tokens} SIN vs ${result.originalTokens} raw (saved ${s.pct})`);
    assert(result.tokens < result.originalTokens, `SIN should be smaller at scale: ${result.tokens} vs ${result.originalTokens}`);
});

test('compressConversation() with limit only keeps N turns', () => {
    const result = compressor.compressConversation(turns, 2);
    assert(result.sin.includes('hist:'), 'expected hist line');
    const histLine = result.sin.split('\n').find(l => l.startsWith('hist:'));
    assert(histLine.split('|').length === 2, 'expected 2 turns in compressed hist');
});

// ── SINParser ─────────────────────────────────────────────────────────────

console.log('\n  [SINParser]');

test('parse() eval extracts SCORE and ISSUES', () => {
    const result = parser.parse('SCORE: 8 ISSUES: response lacks concrete examples', INTENT.EVALUATE);
    assert(result.score === 8, `expected score 8, got ${result.score}`);
    assert(result.issues?.includes('concrete examples'), `expected issues text, got: ${result.issues}`);
});

test('parse() eval handles SCORE:N with no space', () => {
    const result = parser.parse('SCORE:7 ISSUES:too verbose', INTENT.EVALUATE);
    assert(result.score === 7, `expected 7, got ${result.score}`);
});

test('parse() reflect extracts first sentence as narrative', () => {
    const result = parser.parse('I now understand that distributed systems require careful state management. More thoughts.', INTENT.REFLECT);
    assert(result.narrative?.startsWith('I now understand'), `unexpected: ${result.narrative}`);
    assert(result.narrative?.endsWith('.'), 'expected trailing period');
});

test('parse() debate/synth returns full text', () => {
    const result = parser.parse('The architecture should prioritize modularity.', INTENT.DEBATE);
    assert(result.text?.includes('modularity'), `unexpected: ${result.text}`);
});

test('parse() always returns token count', () => {
    const result = parser.parse('some response text', INTENT.REFLECT);
    assert(typeof result.tokens === 'number' && result.tokens > 0, 'expected tokens');
});

test('parse() preserves raw response', () => {
    const raw    = 'SCORE:9 ISSUES:none';
    const result = parser.parse(raw, INTENT.EVALUATE);
    assert(result.raw === raw, 'expected raw preserved');
});

// ── Round-trip: compress → brain response → parse ────────────────────────

console.log('\n  [Round-trip]');

test('eval round-trip: compress → simulate response → parse', () => {
    const { sin } = compressor.evalPrompt({
        query:    'what is the capital of France?',
        response: 'The capital of France is Paris.',
        criteria: ['accuracy', 'brevity'],
    });
    assert(sin.includes('SCORE:'), 'sin should instruct SCORE format');

    // Simulate a brain responding in the expected format
    const simulatedBrainResponse = 'SCORE:9 ISSUES:none — response is accurate and concise';
    const parsed = parser.parse(simulatedBrainResponse, INTENT.EVALUATE);
    assert(parsed.score === 9, `expected 9, got ${parsed.score}`);
    assert(parsed.issues?.includes('accurate'), `unexpected issues: ${parsed.issues}`);
});

test('reflect round-trip: compress → simulate → parse → narrative updated', () => {
    const { sin } = compressor.narrativeReflect({
        query:     'explain recursion',
        response:  'Recursion is a function calling itself.',
        narrative: 'I am learning.',
    });
    assert(sin.includes('intent:reflect'), 'expected reflect');

    const simulatedBrainResponse = 'I realize that explaining fundamentals well reveals gaps in my own understanding.';
    const parsed = parser.parse(simulatedBrainResponse, INTENT.REFLECT);
    assert(parsed.narrative?.startsWith('I realize'), `unexpected narrative: ${parsed.narrative}`);
});

// ── Singleton exports ─────────────────────────────────────────────────────

console.log('\n  [Singleton exports]');

test('compressor singleton is a SINCompressor', () => {
    assert(compressor instanceof SINCompressor, 'expected SINCompressor instance');
});

test('parser singleton is a SINParser', () => {
    assert(parser instanceof SINParser, 'expected SINParser instance');
});

// ─────────────────────────────────────────────────────────────────────────

console.log(`\n── Results: ${passed} passed, ${failed} failed ────────────\n`);
if (failed > 0) process.exit(1);
