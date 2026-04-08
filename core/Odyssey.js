/**
 * ODYSSEY: The Journey (Strategic Navigation)
 *
 * Manages the long voyage from abstract goal to technical completion.
 * Uses Directed Acyclic Graphs (DAG) to ensure prerequisites are met.
 *
 * chart()  — AI-powered voyage generation (original)
 * define() — manual voyage definition (no brain needed)
 * Navigator methods — execution engine with full persistence
 */

import fs             from 'fs';
import path           from 'path';
import { Poseidon }   from './Poseidon.js';

const DEFAULT_VOYAGES_DIR = path.resolve(process.cwd(), 'voyages');

export const STATUS = Object.freeze({
    DOCKED:  'docked',   // ⚓ exists, prereqs not met or not started
    SAILING: 'sailing',  // ⛵ actively executing
    ARRIVED: 'arrived',  // ✓  completed + verification passed
    FAILED:  'failed',   // ⛔ execution error OR verification failed
});

const EMOJI = { docked: '⚓', sailing: '⛵', arrived: '✓', failed: '⛔' };

export class Odyssey {
    /**
     * @param {object} opts
     * @param {string} [opts.voyagesDir] - override storage path (useful for tests)
     */
    constructor(opts = {}) {
        this.voyages     = new Map();
        this._voyagesDir = opts.voyagesDir
            ? path.resolve(opts.voyagesDir)
            : DEFAULT_VOYAGES_DIR;
        this._poseidon   = new Poseidon(opts.poseidon || {});
    }

    // ── Original chart() — AI-powered voyage generation ───────────────────

    /**
     * Map the technical voyage using an LLM brain
     */
    async chart(brain, goal, description) {
        const prompt = `Chart a technical ODYSSEY for this goal.
PROJECT: ${goal}
DESCRIPTION: ${description}

Break the journey into a DAG of milestones.
Each milestone is a prerequisite for the next.

Return ONLY JSON:
{
  "voyageId": "slug",
  "title": "...",
  "milestones": [ { "id": "m1", "label": "...", "task": "..." } ],
  "dependencies": [ { "from": "m1", "to": "m2" } ]
}`;

        try {
            const result  = await brain.think(prompt, { temperature: 0.2 });
            const voyage  = JSON.parse(result.text.match(/\{[\s\S]*\}/)[0]);
            voyage.milestones = voyage.milestones.map(m => ({ ...m, status: STATUS.DOCKED }));
            this.voyages.set(voyage.voyageId, voyage);
            this._saveVoyage(voyage);
            this._appendLog(voyage.voyageId, { event: 'voyage.charted', title: voyage.title });
            return voyage;
        } catch (err) {
            return { error: 'Charting failed', message: err.message };
        }
    }

    // ── Navigator: define a voyage directly (no brain needed) ─────────────

    define(voyageId, title, milestones = []) {
        const voyage = {
            voyageId,
            title,
            createdAt:  new Date().toISOString(),
            milestones: milestones.map(m => ({
                id:        m.id,
                title:     m.title || m.label || m.id,
                deps:      m.deps || [],
                status:    STATUS.DOCKED,
                output:    null,
                startedAt: null,
                arrivedAt: null,
                failedAt:  null,
            })),
            context: {},
        };
        this.voyages.set(voyageId, voyage);
        this._saveVoyage(voyage);
        this._appendLog(voyageId, { event: 'voyage.defined', title });
        return voyage;
    }

    // ── Navigator: execution engine ────────────────────────────────────────

    getUnblocked(voyageId) {
        const voyage     = this._get(voyageId);
        const arrivedIds = new Set(
            voyage.milestones.filter(m => m.status === STATUS.ARRIVED).map(m => m.id)
        );
        return voyage.milestones.filter(m =>
            m.status === STATUS.DOCKED &&
            m.deps.every(dep => arrivedIds.has(dep))
        );
    }

    async advance(voyageId, milestoneId, result = {}) {
        const voyage    = this._get(voyageId);
        const milestone = this._getMilestone(voyage, milestoneId);

        // docked → sailing
        if (milestone.status === STATUS.DOCKED) {
            const arrivedIds = new Set(
                voyage.milestones.filter(m => m.status === STATUS.ARRIVED).map(m => m.id)
            );
            const blocked = milestone.deps.filter(d => !arrivedIds.has(d));
            if (blocked.length > 0) {
                return { state: '\\', value: { error: `Blocked by: ${blocked.join(', ')}` } };
            }
            milestone.status    = STATUS.SAILING;
            milestone.startedAt = new Date().toISOString();
            this._appendLog(voyageId, { milestoneId, from: STATUS.DOCKED, to: STATUS.SAILING });
            this._saveVoyage(voyage);
            return { state: '|', value: { status: STATUS.SAILING } };
        }

        // sailing → arrived or failed
        if (milestone.status === STATUS.SAILING) {
            if (!result.success) {
                milestone.status   = STATUS.FAILED;
                milestone.failedAt = new Date().toISOString();
                milestone.output   = result.output || null;
                this._appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.FAILED });
                this._saveVoyage(voyage);
                const checkpoint = this._restoreCheckpoint(voyageId);
                if (checkpoint) this._appendLog(voyageId, { event: 'checkpoint.restore', checkpointId: checkpoint.checkpointId });
                return { state: '\\', value: { status: STATUS.FAILED, checkpoint } };
            }

            // Poseidon verification gate — TRUE requires a falsification test
            const verification = await this._poseidon.verify(
                `Milestone ${milestoneId} completed`,
                {
                    falsificationTest: result.falsificationTest || null,
                    testResult:        result.verificationPassed !== false && result.verificationPassed !== undefined
                        ? result.verificationPassed
                        : result.falsificationTest ? result.verificationPassed : undefined,
                }
            );

            if (verification.state === 'FALSE') {
                milestone.status   = STATUS.FAILED;
                milestone.failedAt = new Date().toISOString();
                this._appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.FAILED, reason: verification.reason });
                this._saveVoyage(voyage);
                return { state: '\\', value: { status: STATUS.FAILED, reason: verification.reason, verification } };
            }

            // UNCERTAIN = no falsification test provided — warn but allow through
            // (allows milestones without explicit verification to still arrive)
            const verificationState = verification.state;

            milestone.status    = STATUS.ARRIVED;
            milestone.arrivedAt = new Date().toISOString();
            milestone.output    = result.output || null;
            this._appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.ARRIVED });
            this._saveVoyage(voyage);

            const checkpointId = this._saveCheckpoint(voyageId, milestoneId, {
                milestones: voyage.milestones.map(m => ({ id: m.id, status: m.status, output: m.output })),
                context:    voyage.context,
            });
            this._appendLog(voyageId, { milestoneId, event: 'checkpoint.saved', checkpointId });
            return { state: verificationState === 'UNCERTAIN' ? '|' : '/', value: { status: STATUS.ARRIVED, checkpointId, verification } };
        }

        return { state: '\\', value: { error: `Cannot advance from status: ${milestone.status}` } };
    }

    /**
     * Execute a milestone atomically — runs fn, verifies, advances state.
     * Single call replaces the manual docked→sailing→arrived sequence.
     *
     * @param {string}   voyageId
     * @param {string}   milestoneId
     * @param {Function} fn - async () => { output, falsificationTest, testResult }
     * @returns {{ state, value }}
     */
    async execute(voyageId, milestoneId, fn) {
        // docked → sailing
        const sailResult = this.advance(voyageId, milestoneId, {});
        if (sailResult.state === '\\') return sailResult;

        // Run the work
        let output, falsificationTest, testResult;
        try {
            const r        = await fn();
            output            = r?.output ?? r;
            falsificationTest = r?.falsificationTest ?? null;
            testResult        = r?.testResult ?? true;
        } catch (err) {
            return this.advance(voyageId, milestoneId, { success: false, output: err.message });
        }

        // sailing → arrived (with Poseidon verification)
        return this.advance(voyageId, milestoneId, {
            success: true,
            output,
            falsificationTest,
            verificationPassed: testResult,
        });
    }

    async load(voyageId) {
        const f = this._voyageFile(voyageId);
        if (!fs.existsSync(f)) return null;
        const saved = JSON.parse(fs.readFileSync(f, 'utf8'));
        this.voyages.set(voyageId, saved);
        this._appendLog(voyageId, { event: 'voyage.loaded' });
        return saved;
    }

    async persist(voyageId) { this._saveVoyage(this._get(voyageId)); }

    summary(voyageId) {
        const voyage  = this._get(voyageId);
        const total   = voyage.milestones.length;
        const arrived = voyage.milestones.filter(m => m.status === STATUS.ARRIVED);
        return {
            voyageId:  voyage.voyageId,
            title:     voyage.title,
            progress:  `${arrived.length}/${total}`,
            arrived:   arrived.map(m => m.id),
            active:    voyage.milestones.filter(m => m.status === STATUS.SAILING).map(m => m.id),
            blocked:   voyage.milestones.filter(m => m.status === STATUS.DOCKED).map(m => m.id),
            failed:    voyage.milestones.filter(m => m.status === STATUS.FAILED).map(m => m.id),
        };
    }

    contextDump(voyageId) {
        const voyage = this._get(voyageId);
        const parts  = [`VOYAGE:${voyageId}`];
        for (const m of voyage.milestones) parts.push(`${m.id}${EMOJI[m.status] || '?'}`);
        return parts.join(' ');
    }

    listCheckpoints(voyageId)   { return this._listCheckpoints(voyageId); }
    restoreCheckpoint(voyageId) { return this._restoreCheckpoint(voyageId); }

    // ── Private persistence helpers ────────────────────────────────────────

    _vDir(voyageId)      { return path.join(this._voyagesDir, voyageId); }
    _voyageFile(voyageId){ return path.join(this._vDir(voyageId), 'voyage.json'); }
    _cpDir(voyageId)     { return path.join(this._vDir(voyageId), 'checkpoints'); }
    _logFile(voyageId)   { return path.join(this._vDir(voyageId), 'log.ndjson'); }

    _ensureDirs(voyageId) {
        fs.mkdirSync(this._cpDir(voyageId), { recursive: true });
    }

    _saveVoyage(voyage) {
        this._ensureDirs(voyage.voyageId);
        const serialized = {
            ...voyage,
            milestones: voyage.milestones.map(({ _verify, ...rest }) => rest),
        };
        fs.writeFileSync(this._voyageFile(voyage.voyageId), JSON.stringify(serialized, null, 2));
    }

    _appendLog(voyageId, entry) {
        this._ensureDirs(voyageId);
        fs.appendFileSync(this._logFile(voyageId),
            JSON.stringify({ ts: new Date().toISOString(), voyageId, ...entry }) + '\n');
    }

    _saveCheckpoint(voyageId, milestoneId, snapshot) {
        const checkpointId = `${milestoneId}_${Date.now()}`;
        fs.writeFileSync(
            path.join(this._cpDir(voyageId), `${checkpointId}.json`),
            JSON.stringify({
                voyageId, checkpointId,
                timestamp:      new Date().toISOString(),
                afterMilestone: milestoneId,
                milestones:     snapshot.milestones,
                context:        snapshot.context || {},
            }, null, 2)
        );
        return checkpointId;
    }

    _restoreCheckpoint(voyageId) {
        const dir = this._cpDir(voyageId);
        if (!fs.existsSync(dir)) return null;
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
        if (!files.length) return null;
        return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
    }

    _listCheckpoints(voyageId) {
        const dir = this._cpDir(voyageId);
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(f => f.endsWith('.json'))
            .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    }

    _get(voyageId) {
        const v = this.voyages.get(voyageId);
        if (!v) throw new Error(`Voyage not found: "${voyageId}" — call define() or load() first`);
        return v;
    }

    _getMilestone(voyage, id) {
        const m = voyage.milestones.find(m => m.id === id);
        if (!m) throw new Error(`Milestone not found: "${id}"`);
        return m;
    }
}
