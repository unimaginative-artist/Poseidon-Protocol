/**
 * ODYSSEY: The Journey (Strategic Navigation)
 *
 * Manages the long voyage from abstract goal to technical completion.
 * Uses Directed Acyclic Graphs (DAG) to ensure prerequisites are met.
 *
 * chart()  — AI-powered voyage generation (original)
 * Navigator methods — execution engine with full persistence (new)
 */

import fs   from 'fs';
import path from 'path';

const VOYAGES_DIR = path.resolve(process.cwd(), 'voyages');

// ── Milestone status lifecycle — strict, no skipping ──────────────────────
export const STATUS = Object.freeze({
    DOCKED:  'docked',   // ⚓ exists, prereqs not met or not started
    SAILING: 'sailing',  // ⛵ actively executing
    ARRIVED: 'arrived',  // ✓  completed + verification passed
    FAILED:  'failed',   // ⛔ execution error OR verification failed
});

const EMOJI = { docked: '⚓', sailing: '⛵', arrived: '✓', failed: '⛔' };

// ── Persistence helpers ────────────────────────────────────────────────────

function voyageDir(voyageId)  { return path.join(VOYAGES_DIR, voyageId); }
function voyageFile(voyageId) { return path.join(voyageDir(voyageId), 'voyage.json'); }
function cpDir(voyageId)      { return path.join(voyageDir(voyageId), 'checkpoints'); }
function logFile(voyageId)    { return path.join(voyageDir(voyageId), 'log.ndjson'); }

function ensureDirs(voyageId) {
    fs.mkdirSync(cpDir(voyageId), { recursive: true });
}

function saveVoyage(voyage) {
    ensureDirs(voyage.voyageId);
    const serialized = {
        ...voyage,
        milestones: voyage.milestones.map(({ _verify, ...rest }) => rest),
    };
    fs.writeFileSync(voyageFile(voyage.voyageId), JSON.stringify(serialized, null, 2));
}

function loadVoyageFromDisk(voyageId) {
    const f = voyageFile(voyageId);
    if (!fs.existsSync(f)) return null;
    return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function appendLog(voyageId, entry) {
    ensureDirs(voyageId);
    fs.appendFileSync(logFile(voyageId),
        JSON.stringify({ ts: new Date().toISOString(), voyageId, ...entry }) + '\n');
}

function saveCheckpoint(voyageId, milestoneId, snapshot) {
    const checkpointId = `${milestoneId}_${Date.now()}`;
    const data = {
        voyageId,
        checkpointId,
        timestamp:      new Date().toISOString(),
        afterMilestone: milestoneId,
        milestones:     snapshot.milestones,
        context:        snapshot.context || {},
    };
    fs.writeFileSync(
        path.join(cpDir(voyageId), `${checkpointId}.json`),
        JSON.stringify(data, null, 2)
    );
    return checkpointId;
}

function restoreCheckpoint(voyageId) {
    const dir   = cpDir(voyageId);
    if (!fs.existsSync(dir)) return null;
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    if (!files.length) return null;
    return JSON.parse(fs.readFileSync(path.join(dir, files[files.length - 1]), 'utf8'));
}

function listCheckpoints(voyageId) {
    const dir = cpDir(voyageId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

// ── Odyssey ────────────────────────────────────────────────────────────────

export class Odyssey {
    constructor() {
        this.voyages = new Map();
    }

    // ── Original chart() — AI-powered voyage generation ───────────────────

    /**
     * Map the technical voyage using an LLM brain
     * @param {object} brain - has .think(prompt, opts) method
     * @param {string} goal
     * @param {string} description
     * @returns {object} voyage
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
            saveVoyage(voyage);
            appendLog(voyage.voyageId, { event: 'voyage.charted', title: voyage.title });
            return voyage;
        } catch (err) {
            return { error: 'Charting failed', message: err.message };
        }
    }

    // ── Navigator: define a voyage directly (no brain needed) ─────────────

    /**
     * Define a voyage manually as a DAG — no brain required
     * @param {string} voyageId
     * @param {string} title
     * @param {Array}  milestones - [{ id, title, deps: [] }]
     * @returns {object} voyage
     */
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
        saveVoyage(voyage);
        appendLog(voyageId, { event: 'voyage.defined', title });
        return voyage;
    }

    // ── Navigator: execution engine ────────────────────────────────────────

    /**
     * Get milestones that are unblocked: all deps arrived, status docked
     * @param {string} voyageId
     * @returns {Array}
     */
    getUnblocked(voyageId) {
        const voyage    = this._get(voyageId);
        const arrivedIds = new Set(
            voyage.milestones.filter(m => m.status === STATUS.ARRIVED).map(m => m.id)
        );
        return voyage.milestones.filter(m =>
            m.status === STATUS.DOCKED &&
            m.deps.every(dep => arrivedIds.has(dep))
        );
    }

    /**
     * Advance a milestone through its lifecycle.
     * docked → sailing (call with no result)
     * sailing → arrived (call with { success: true, output, verificationPassed: true })
     * sailing → failed  (call with { success: false } or { verificationPassed: false })
     *
     * @param {string} voyageId
     * @param {string} milestoneId
     * @param {object} result
     * @returns {{ state: string, value: any }}
     */
    advance(voyageId, milestoneId, result = {}) {
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
            appendLog(voyageId, { milestoneId, from: STATUS.DOCKED, to: STATUS.SAILING });
            saveVoyage(voyage);
            return { state: '|', value: { status: STATUS.SAILING } };
        }

        // sailing → arrived or failed
        if (milestone.status === STATUS.SAILING) {
            if (!result.success) {
                milestone.status   = STATUS.FAILED;
                milestone.failedAt = new Date().toISOString();
                milestone.output   = result.output || null;
                appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.FAILED });
                saveVoyage(voyage);
                const checkpoint = restoreCheckpoint(voyageId);
                if (checkpoint) appendLog(voyageId, { event: 'checkpoint.restore', checkpointId: checkpoint.checkpointId });
                return { state: '\\', value: { status: STATUS.FAILED, checkpoint } };
            }

            if (result.verificationPassed === false) {
                milestone.status   = STATUS.FAILED;
                milestone.failedAt = new Date().toISOString();
                appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.FAILED, reason: 'verification.failed' });
                saveVoyage(voyage);
                return { state: '\\', value: { status: STATUS.FAILED, reason: 'verification.failed' } };
            }

            milestone.status    = STATUS.ARRIVED;
            milestone.arrivedAt = new Date().toISOString();
            milestone.output    = result.output || null;
            appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.ARRIVED });
            saveVoyage(voyage);

            const checkpointId = saveCheckpoint(voyageId, milestoneId, {
                milestones: voyage.milestones.map(m => ({ id: m.id, status: m.status, output: m.output })),
                context:    voyage.context,
            });
            appendLog(voyageId, { milestoneId, event: 'checkpoint.saved', checkpointId });
            return { state: '/', value: { status: STATUS.ARRIVED, checkpointId } };
        }

        return { state: '\\', value: { error: `Cannot advance from status: ${milestone.status}` } };
    }

    /**
     * Load a voyage from disk — resume exactly where it left off
     * @param {string} voyageId
     * @returns {object|null}
     */
    async load(voyageId) {
        const saved = loadVoyageFromDisk(voyageId);
        if (!saved) return null;
        this.voyages.set(voyageId, saved);
        appendLog(voyageId, { event: 'voyage.loaded' });
        return saved;
    }

    /**
     * Persist current voyage state to disk
     * @param {string} voyageId
     */
    async persist(voyageId) {
        saveVoyage(this._get(voyageId));
    }

    /**
     * Human-readable status summary
     * @param {string} voyageId
     * @returns {object}
     */
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

    /**
     * Compact context dump — loads full voyage state in one line, under 120 chars
     * Format: "VOYAGE:slug m1✓ m2⚓ m3⛵ m4⛔"
     * @param {string} voyageId
     * @returns {string}
     */
    contextDump(voyageId) {
        const voyage = this._get(voyageId);
        const parts  = [`VOYAGE:${voyageId}`];
        for (const m of voyage.milestones) {
            parts.push(`${m.id}${EMOJI[m.status] || '?'}`);
        }
        return parts.join(' ');
    }

    // ── Checkpoint API ─────────────────────────────────────────────────────

    listCheckpoints(voyageId)  { return listCheckpoints(voyageId); }
    restoreCheckpoint(voyageId) { return restoreCheckpoint(voyageId); }

    // ── Internal ───────────────────────────────────────────────────────────

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
