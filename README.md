# Poseidon Protocol

**A framework for epistemic integrity in autonomous systems.**

Most AI systems are binary: answer or refuse. Confident or silent. This is architecturally dishonest — the world is not binary, and neither is knowledge. Poseidon Protocol gives autonomous systems a third state: *uncertain*. And it makes them earn the first one.

---

## The Problem

When an LLM says something, it has no native mechanism to ask *"what would prove me wrong?"* It generates. It asserts. It moves on. This is fine for autocomplete. It's dangerous for systems that take actions, manage goals, and modify code based on their own reasoning.

The result is a specific failure mode: **confident hallucination**. The system is wrong, but it doesn't know it's wrong, so it acts on it anyway.

---

## The Solution: Ternary Epistemic States

Poseidon Protocol introduces three states for any claim or action:

| State | Symbol | Meaning |
|-------|--------|---------|
| TRUE | `/` | Claim has passed a falsification test — confidence is *earned* |
| UNCERTAIN | `\|` | No falsification test available — honest about the gap |
| FALSE | `\` | Claim failed its test — rejected |

The key rule: **TRUE must be earned, not assumed.**

A system cannot simply assert TRUE. It must provide a falsification test — a concrete way to prove the claim wrong — and pass it. If no test is provided, the state is UNCERTAIN. This is not a failure. Uncertainty is honest.

---

## Components

### `Poseidon` — The Epistemic Core

```javascript
import { Poseidon } from 'poseidon-protocol';

const poseidon = new Poseidon({ threshold: 0.75 });

// filter() — confidence-based ternary state
await poseidon.filter('claim', 0.9);  // → { state: 'TRUE' }
await poseidon.filter('claim', 0.1);  // → { state: 'FALSE' }
await poseidon.filter('claim', 0.5);  // → { state: 'UNCERTAIN' }

// verify() — falsification-based. TRUE must be earned.
await poseidon.verify('claim', {});
// → { state: 'UNCERTAIN' }  — no test provided, honest about it

await poseidon.verify('claim', {
    falsificationTest: 'Does the output match expected?',
    testResult: false
});
// → { state: 'FALSE' }

await poseidon.verify('claim', {
    falsificationTest: 'Does the output match expected?',
    testResult: true
});
// → { state: 'TRUE' }  — confidence earned through falsification
```

---

### `Odyssey` — The Navigation Engine

Long-running tasks fail because there's no structured way to track progress, checkpoint state, or recover from partial failures. Odyssey provides a DAG-based voyage system with full persistence.

```javascript
import { Odyssey, STATUS } from 'poseidon-protocol';

const odyssey = new Odyssey({ voyagesDir: './voyages' });

// Define a voyage — a DAG of milestones with dependencies
odyssey.define('build-auth', 'Auth System', [
    { id: 'schema',   title: 'Design schema',    deps: [] },
    { id: 'tokens',   title: 'Token store',      deps: ['schema'] },
    { id: 'validate', title: 'Validation layer', deps: ['tokens'] },
    { id: 'gateway',  title: 'API gateway',      deps: ['validate'] },
]);

// Execute atomically — docked → sailing → arrived (with Poseidon verification)
const result = await odyssey.execute('build-auth', 'schema', async () => ({
    output:            { schema: 'users, tokens, sessions' },
    falsificationTest: 'Does schema have all required tables?',
    testResult:        true,
}));
// result.state === '/'  — arrived and verified
```

States during execution:

| State | Meaning |
|-------|---------|
| `\|` | Milestone started (docked → sailing) |
| `/` | Milestone completed and verified (TRUE) |
| `\` | Blocked by unmet dependencies OR verification failed |

Checkpoints are saved automatically on arrival. Progress persists across restarts. Rollback is available on failure.

---

### `Trident` — The Architect

Converts high-level architecture plans into Odyssey voyage DAGs.

```javascript
import { Trident, Odyssey } from 'poseidon-protocol';

const trident = new Trident();
const voyage  = trident.toVoyage(architecture);
// Returns milestones with inferred dependencies and falsification tests

odyssey.define(voyage.voyageId, voyage.title, voyage.milestones);
```

---

### `SIN` — Structured Internal Notation

Internal LLM calls (reflection, debate, evaluation) don't need prose. They need structured intent. SIN compresses internal prompts by 30-70%, making large-context systems significantly more efficient.

```javascript
import { SINCompressor, SINParser, INTENT } from 'poseidon-protocol/core/SIN';

const compressor = new SINCompressor();

// Compress a narrative reflection call
const { sin, tokens, savedVs } = compressor.narrativeReflect({
    query:     'user wants to refactor the auth module',
    response:  'suggested extracting token validation into a separate service',
    narrative: 'small focused services are more testable',
});
// SIN: ~115 tokens vs ~159 tokens verbose (28% reduction)
// At scale with full history: 96 tokens vs 320 raw (70% reduction)

// Compress full conversation history
const { sin: hist } = compressor.compressConversation(conversationTurns);

// Parse structured brain responses
const parsed = parser.parse(brainResponse, INTENT.EVALUATE);
// → { score: 8, issues: 'lacks concrete examples', tokens: 12 }
```

The compression pays off with longer conversations — the 70% reduction comes from turning verbose turn-by-turn history into structured role:content summaries. A 1M context window with SIN compression holds 5-7x more real conversation.

---

### `NauticalEncoder` + `NauticalParser` — Inter-Agent Communication

Structured notation for messages between autonomous agents. 17 core tokens with epistemic state prefixes.

```javascript
import { NauticalEncoder, NauticalParser } from 'poseidon-protocol';

const line = encoder.message({
    from: 'MAX', to: 'SOMA',
    state: '/',    // TRUE — confirmed
    token: ':.^',  // mem.save
    operand: 'auth_ctx'
});
// "[MAX]→[SOMA] / :.^ auth_ctx"

const parsed = parser.parseLine(line);
// { from: 'MAX', to: 'SOMA', epistemicState: '/', token: ':.^', operand: 'auth_ctx' }
```

---

## Why This Matters

The standard approach to AI reliability is to make systems more confident — bigger models, more RLHF, better fine-tuning. Poseidon Protocol takes the opposite position: **make uncertainty a first-class value**.

A system that knows it doesn't know is more trustworthy than one that doesn't know it doesn't know.

Practically this means:
- Goals that previously failed get deprioritized before they're attempted again
- Engineering tasks track each phase with checkpoints — partial failures don't corrupt completed work  
- Factual claims get spot-checked against external sources before being marked TRUE
- Every response carries an epistemic state the downstream system can act on

---

## Installation

```bash
npm install poseidon-protocol
```

Or clone directly:

```bash
git clone https://github.com/unimaginative-artist/Poseidon-Protocol.git
cd Poseidon-Protocol
npm test  # 81/81 passing
```

---

## Test Suite

```
npm test

Odyssey Navigator     13/13  ✓
NauticalParser        14/14  ✓
Integration           13/13  ✓
SIN Compression       41/41  ✓
─────────────────────────────
Total                 81/81
```

---

## Architecture

```
Poseidon   epistemic filter — ternary TRUE / UNCERTAIN / FALSE
Odyssey    voyage execution — DAG milestones, checkpoints, rollback
Trident    architecture → voyage DAG conversion
SIN        internal prompt compression — 30-70% token reduction
Nautical   inter-agent communication notation
```

Each component is independent. Together they form a complete framework for autonomous systems that reason carefully, track work reliably, and communicate precisely.

---

## License

MIT

---

*Built by Barry. One person. No team. The conviction that AI systems should earn their confidence.*
