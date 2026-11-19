/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const FAMILIES = ['colors', 'geometry', 'lut', 'mask', 'optics', 'preview', 'repair', 'spatial'];
const PATHS = new Map(FAMILIES.map(family => [`lightscaper-develop-gpu-${family}-current.spec.js`, Object.freeze([
	`/__lightscaper_develop_gpu_${family}_current.js`,
	...family === 'preview' ? ['/__lightscaper_gpu_mask_preview_broker_current.js'] : [],
])]));
/** @typedef {{url:string;byteLength:number;sha256:string;observed:boolean}} Observation */
/** @typedef {{origin:string;testFile:string;captures:(url:string)=>boolean;attest:(url:string,source:unknown)=>boolean;complete:()=>Observation[]}} Facet */
/** @type {WeakMap<object, Facet>} */
const OWNERS = new WeakMap();

/** @param {string} testFile */
export function browserCoverageObserverPaths(testFile) { return PATHS.get(basename(testFile)) ?? Object.freeze([]); }

/** @param {{testFile:string;origin:string}} options */
export function createBrowserCoverageObserverRoutes({ testFile, origin }) {
	const paths = browserCoverageObserverPaths(testFile);
	if (!paths.length) return null;
	const parsed = new URL(origin);
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Observer origin must be exact.');
	/** @type {Map<string, {source:string;byteLength:number;sha256:string;observed:boolean}>} */
	const entries = new Map();
	let navigation = false, closed = false;
	const current = () => { if (closed) throw new Error('Observer owner is closed.'); };
	const owner = Object.freeze({
		/** @param {string} pathname @param {string} source */
		register(pathname, source) {
			current();
			if (navigation) throw new Error('Observer registration is sealed after navigation.');
			if (!paths.includes(pathname)) throw new Error('Observer route is not owned by this exact spec.');
			if (typeof source !== 'string' || !source.length) throw new Error('Observer source bytes are required.');
			const url = origin + pathname;
			if (entries.has(url)) throw new Error('Observer route is already registered.');
			entries.set(url, { source, byteLength: Buffer.byteLength(source), sha256: createHash('sha256').update(source).digest('hex'), observed: false });
			return url;
		},
		navigationStarted() { current(); navigation = true; },
		close() { closed = true; },
	});
	OWNERS.set(owner, Object.freeze({
		origin, testFile,
		captures(url) { current(); return entries.has(url); },
		attest(url, source) {
			current(); const entry = entries.get(url); if (!entry) return false;
			if (typeof source !== 'string' || source !== entry.source) throw new Error('Observed test program source bytes differ.');
			entry.observed = true; return true;
		},
		complete() {
			current();
			if ([...entries.values()].some(entry => !entry.observed)) throw new Error('Registered observer was not source-attested after execution.');
			return [...entries].map(([url, { byteLength, sha256, observed }]) => ({ url, byteLength, sha256, observed }));
		},
	}));
	return owner;
}

/** The collector accepts source-owned facets, never arbitrary exclusion callbacks. @param {unknown} value */
export function captureBrowserCoverageObserverRoutes(value) {
	if (value === null || value === undefined) return null;
	const facet = typeof value === 'object' ? OWNERS.get(value) : undefined;
	if (!facet) throw new Error('A genuine observer owner is required.');
	return facet;
}
