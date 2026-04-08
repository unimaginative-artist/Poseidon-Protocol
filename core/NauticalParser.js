// ═══════════════════════════════════════════════════════════════════════════
// NauticalParser.js — parses Nautical Notation (.:!<^> grammar)
// Invalid tokens return null and emit ~: unknown.token — never throw.
// ═══════════════════════════════════════════════════════════════════════════

import { RegistryLoader } from './RegistryLoader.js';
import path               from 'path';
import { fileURLToPath }  from 'url';

// Epistemic state symbols — inline to avoid coupling to Poseidon class internals
const STATES = { TRUE: '/', FALSE: '\\', UNCERTAIN: '|' };

const __dirname      = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH  = path.resolve(__dirname, '../registry/registry.json');

// Protocol header pattern: POSEIDON::0.1 REGISTRY::17 ARBITER::name VOYAGE::id
const HEADER_RE = /^POSEIDON::(\S+)\s+REGISTRY::(\d+)\s+ARBITER::(\S+)\s+VOYAGE::(\S+)/;

// Arbiter address pattern: [NAME] or [NAME]→[NAME]
const ADDRESS_RE   = /^\[([A-Z0-9_]+)\]/;
const DIRECTION_RE = /^\[([A-Z0-9_]+)\]\s*→\s*\[([A-Z0-9_]+)\]/;

// Epistemic state prefix: / \ |
const EPISTEMIC_RE = /^([/\\|])\s+/;

export class NauticalParser {
    constructor(registryPath = REGISTRY_PATH) {
        this.registry = new RegistryLoader();
        try {
            this.registry.load(registryPath);
        } catch {
            // Non-fatal — parser works without registry, just can't validate
        }
        this._warnings = [];
    }

    /**
     * Parse a single token string
     * @param {string} token
     * @returns {{ domain, operation, target, modifier, alias } | null}
     */
    parse(token) {
        if (!token || typeof token !== 'string') return null;
        const entry = this.registry.lookup(token.trim());
        if (!entry) {
            this._warn(`~: unknown.token "${token}"`);
            return null;
        }
        return {
            token:     entry.token,
            domain:    entry.domain,
            operation: entry.operation,
            target:    entry.target,
            modifier:  entry.modifier || null,
            alias:     entry.alias,
            id:        entry.id,
        };
    }

    /**
     * Parse a full message line
     * Format: [FROM]→[TO] epistemicState token operand
     *      or [FROM] epistemicState token operand
     *      or token operand
     *
     * @param {string} line
     * @returns {{ from, to, epistemicState, token, parsed, operand } | null}
     */
    parseLine(line) {
        if (!line || typeof line !== 'string') return null;
        let rest = line.trim();
        if (!rest || rest.startsWith('//') || rest.startsWith('#')) return null;

        const result = {
            from:          null,
            to:            null,
            epistemicState: null,
            token:         null,
            parsed:        null,
            operand:       null,
            raw:           line,
        };

        // Extract arbiter addressing
        const dirMatch = rest.match(DIRECTION_RE);
        if (dirMatch) {
            result.from = dirMatch[1];
            result.to   = dirMatch[2];
            rest = rest.slice(dirMatch[0].length).trim();
            // Strip optional →  separator text after addresses
            rest = rest.replace(/^\s*:\s*/, '').trim();
        } else {
            const addrMatch = rest.match(ADDRESS_RE);
            if (addrMatch) {
                result.from = addrMatch[1];
                rest = rest.slice(addrMatch[0].length).trim();
                // Optional → TO
                const toMatch = rest.match(/^→\s*\[([A-Z0-9_]+)\]\s*/);
                if (toMatch) {
                    result.to = toMatch[1];
                    rest = rest.slice(toMatch[0].length).trim();
                }
                rest = rest.replace(/^\s*:\s*/, '').trim();
            }
        }

        // Extract epistemic state prefix (/ \ |)
        const epMatch = rest.match(EPISTEMIC_RE);
        if (epMatch) {
            result.epistemicState = epMatch[1] === '/'  ? STATES.TRUE
                                  : epMatch[1] === '\\' ? STATES.FALSE
                                  : STATES.UNCERTAIN;
            rest = rest.slice(epMatch[0].length).trim();
        }

        // Extract token (first word) and operand (rest)
        const parts = rest.split(/\s+/);
        if (parts.length === 0 || !parts[0]) return null;

        result.token   = parts[0];
        result.operand = parts.slice(1).join(' ') || null;
        result.parsed  = this.parse(result.token);

        return result;
    }

    /**
     * Validate a token against the registry
     * @param {string} token
     * @returns {{ valid: boolean, entry: object | null }}
     */
    validate(token) {
        const entry = this.registry.lookup(token?.trim());
        return { valid: !!entry, entry: entry || null };
    }

    /**
     * Parse a full session transcript
     * @param {string} text - multi-line session text
     * @returns {Array} parsed lines with full metadata
     */
    parseSession(text) {
        if (!text || typeof text !== 'string') return [];
        const lines  = text.split('\n');
        const result = { header: null, messages: [], warnings: [] };

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Check for protocol header
            const headerMatch = trimmed.match(HEADER_RE);
            if (headerMatch) {
                result.header = {
                    version:    headerMatch[1],
                    registryCount: parseInt(headerMatch[2], 10),
                    arbiter:    headerMatch[3],
                    voyageId:   headerMatch[4],
                };
                continue;
            }

            const parsed = this.parseLine(trimmed);
            if (parsed) {
                result.messages.push(parsed);
            }
        }

        result.warnings = [...this._warnings];
        this._warnings  = [];
        return result;
    }

    /**
     * Parse arbiter address from a string
     * @param {string} str
     * @returns {{ from: string|null, to: string|null, rest: string }}
     */
    parseAddress(str) {
        if (!str) return { from: null, to: null, rest: str };
        let rest = str.trim();

        const dirMatch = rest.match(DIRECTION_RE);
        if (dirMatch) {
            return {
                from: dirMatch[1],
                to:   dirMatch[2],
                rest: rest.slice(dirMatch[0].length).trim(),
            };
        }

        const addrMatch = rest.match(ADDRESS_RE);
        if (addrMatch) {
            return {
                from: addrMatch[1],
                to:   null,
                rest: rest.slice(addrMatch[0].length).trim(),
            };
        }

        return { from: null, to: null, rest };
    }

    _warn(msg) {
        this._warnings.push({ ts: new Date().toISOString(), warning: msg });
    }

    getWarnings() { return [...this._warnings]; }
}
