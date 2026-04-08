// ═══════════════════════════════════════════════════════════════════════════
// RegistryLoader.js — loads registry.json or registry.csv, exposes lookup
// ═══════════════════════════════════════════════════════════════════════════

import fs   from 'fs';
import path from 'path';

export class RegistryLoader {
    constructor() {
        this._tokens = new Map(); // token string → entry
        this._aliases = new Map(); // alias → entry
        this._loaded  = false;
    }

    /**
     * Load registry from file (auto-detects JSON or CSV)
     * @param {string} filePath
     */
    load(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Registry file not found: ${filePath}`);
        }
        const ext = path.extname(filePath).toLowerCase();
        const raw = fs.readFileSync(filePath, 'utf8');

        const entries = ext === '.csv' ? this._parseCSV(raw) : this._parseJSON(raw);
        for (const entry of entries) {
            this._tokens.set(entry.token, entry);
            if (entry.alias) this._aliases.set(entry.alias, entry);
        }
        this._loaded = true;
        return this;
    }

    /**
     * Look up a token by its symbol string
     * @param {string} token
     * @returns {object|null}
     */
    lookup(token) {
        return this._tokens.get(token) || null;
    }

    /**
     * Look up a token by its alias
     * @param {string} alias
     * @returns {object|null}
     */
    lookupAlias(alias) {
        return this._aliases.get(alias) || null;
    }

    /**
     * Get all registered tokens
     * @returns {Array}
     */
    all() {
        return [...this._tokens.values()];
    }

    /**
     * Check if a token is registered
     * @param {string} token
     * @returns {boolean}
     */
    has(token) {
        return this._tokens.has(token);
    }

    _parseJSON(raw) {
        const data = JSON.parse(raw);
        return Array.isArray(data) ? data : (data.tokens || []);
    }

    _parseCSV(raw) {
        const lines  = raw.trim().split('\n');
        const header = lines[0].split(',').map(h => h.trim());
        return lines.slice(1).map(line => {
            const values = line.split(',');
            const entry  = {};
            header.forEach((h, i) => { entry[h] = (values[i] || '').trim(); });
            if (entry.id) entry.id = parseInt(entry.id, 10);
            return entry;
        });
    }
}
