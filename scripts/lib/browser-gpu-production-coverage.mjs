/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import v8ToIstanbul from 'v8-to-istanbul';
import { E2E_REPOSITORY_URL_PREFIX } from './e2e-coverage-prefixes.mjs';
import { repositorySourcePath } from './e2e-coverage-source-maps.mjs';

const SOURCES = Object.freeze(['src/common/editor/imaging/image-develop-gpu-current-v1.ts',
	'src/common/editor/imaging/pixel-frame-webgl2-context-current-v1.ts']);
const PORTABLE = 'file:///__soundscaper_e2e__/browser/lightscaper/';
/** @typedef {import('@jridgewell/trace-mapping').EncodedSourceMap & {x_soundscaper_source_sha256?: readonly (string | null)[]}} OwnerMap */

/** Use the same V8/Istanbul remapper as maintained coverage, with actual function ranges.
 * Module initialization, map inventory and observer copies cannot stand in for executed shipped functions.
 * @param {{result:Array<{url:string;functions:import('inspector').Profiler.FunctionCoverage[]}>;'source-map-cache':Record<string,{data:OwnerMap}>}} profile
 * @param {{repositoryRoot:string;outputDirectory:string}} options
 */
export async function assertBuiltLightscaperGpuCoverage(profile, { repositoryRoot, outputDirectory }) {
	const output = resolve(outputDirectory), root = resolve(repositoryRoot);
	const hits = new Map(SOURCES.map(path => [path, { path, executedFunctions: 0, executedStatements: 0 }]));
	for (const entry of profile.result) {
		const path = builtPath(entry.url, output);
		if (path === null) continue;
		const cached = profile['source-map-cache'][entry.url];
		if (!cached || !Array.isArray(cached.data.sources) || !cached.data.sources.some(source => hits.has(sourcePath(source, root)))) continue;
		const map = await authenticateOwnerSources(cached.data, root);
		const originalSource = map.sourcesContent.find(content => typeof content === 'string');
		if (typeof originalSource !== 'string') throw new Error('GPU coverage requires original source bytes.');
		const source = await readFile(path, 'utf8');
		const converter = v8ToIstanbul(path, 0, { source, originalSource, sourceMap: { sourcemap: map } });
		try {
			await converter.load(); converter.applyCoverage(entry.functions);
			for (const coverage of Object.values(converter.toIstanbul())) {
				const hit = hits.get(sourcePath(coverage.path, root)); if (!hit) continue;
				hit.executedFunctions += Object.values(coverage.f).filter(count => count > 0).length;
				hit.executedStatements += Object.values(coverage.s).filter(count => count > 0).length;
			}
		} finally { converter.destroy(); }
	}
	if ([...hits.values()].some(hit => !hit.executedFunctions || !hit.executedStatements)) {
		throw new Error(`Built GPU coverage requires executed broker and WebGL functions: ${JSON.stringify([...hits.values()])}`);
	}
	return [...hits.values()];
}

/** Relocation replaces text with build-time hashes. Restore only the required
 * owners after proving their actual bytes, without changing the retained map.
 * @param {OwnerMap} map @param {string} root
 */
async function authenticateOwnerSources(map, root) {
	const hashes = map.x_soundscaper_source_sha256;
	if (map.sourcesContent !== undefined && (!Array.isArray(map.sourcesContent) || map.sourcesContent.length !== map.sources.length)
		|| hashes !== undefined && (!Array.isArray(hashes) || hashes.length !== map.sources.length)) throw new Error('GPU coverage requires authentic mapped owner source bytes.');
	const sourcesContent = map.sources.map((_, index) => map.sourcesContent?.[index] ?? null);
	for (const [index, source] of map.sources.entries()) {
		const owner = sourcePath(source, root); if (!SOURCES.includes(owner)) continue;
		const actual = await readFile(resolve(root, owner), 'utf8');
		const digest = createHash('sha256').update(actual).digest('hex'), expected = hashes?.[index], embedded = map.sourcesContent?.[index];
		if (typeof embedded === 'string' && embedded !== actual || hashes !== undefined && expected !== digest
			|| typeof embedded !== 'string' && expected !== digest) throw new Error(`GPU coverage has stale or unproved build-time owner source bytes: ${owner}.`);
		sourcesContent[index] = actual;
	}
	return { ...map, sourcesContent };
}

function builtPath(url, output) {
	let path;
	try { path = url.startsWith(PORTABLE) ? resolve(output, decodeURIComponent(url.slice(PORTABLE.length))) : fileURLToPath(url); }
	catch { return null; }
	const local = relative(output, path);
	if (isAbsolute(local) || local.startsWith('..') || !local.split(sep).join('/').startsWith('assets/') || !local.endsWith('.js')) return null;
	return path;
}
function sourcePath(value, root) {
	if (typeof value !== 'string') return '';
	if (value.startsWith(E2E_REPOSITORY_URL_PREFIX)) return decodeURIComponent(value.slice(E2E_REPOSITORY_URL_PREFIX.length));
	const portable = value.replaceAll('\\', '/').match(/^(?:[A-Za-z]:)?\/__soundscaper_repo__\/(.+)$/u);
	if (portable) return decodeURIComponent(portable[1]);
	let path = value;
	try { if (value.startsWith('file:')) path = fileURLToPath(value); } catch { return ''; }
	// Hosted build maps retain their producer checkout address. Reuse the E2E
	// map owner parser; the exact required owners still authenticate their text
	// against the build-time digest before any actual V8 function is counted.
	if (isAbsolute(path)) {
		const owner = repositorySourcePath(pathToFileURL(path).href);
		if (owner !== null && SOURCES.includes(owner)) return owner;
	}
	return relative(root, path).split(sep).join('/');
}
