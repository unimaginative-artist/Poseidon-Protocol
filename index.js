/**
 * Poseidon Protocol — main entry point
 *
 * Import everything from here:
 *   import { Poseidon, Trident, Odyssey, NauticalParser, NauticalEncoder, SINCompressor, SINParser } from 'poseidon-protocol'
 */

export { Poseidon }                                               from './core/Poseidon.js';
export { Trident }                                                from './core/Trident.js';
export { Odyssey, STATUS }                                        from './core/Odyssey.js';
export { NauticalParser }                                         from './core/NauticalParser.js';
export { NauticalEncoder }                                        from './core/NauticalEncoder.js';
export { RegistryLoader }                                         from './core/RegistryLoader.js';
export { SINCompressor, SINParser, INTENT, DOMAIN,
         compressor as sinCompressor, parser as sinParser,
         estimateTokens, compressHistory, detectDomain }          from './core/SIN.js';
