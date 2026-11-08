/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { E2E_REPOSITORY_URL_PREFIX } from './e2e-coverage-prefixes.mjs';
import { rebasePortableV8Profile } from './e2e-coverage-runner.mjs';
import { isGeneratedE2ERepositoryPath } from './e2e-coverage-source-maps.mjs';

/** Relocate authenticated source ownership, leaving recorded V8 ranges intact.
 * The ordinary gate owns src/ and desktop/; generated artifact admission remains
 * with the separate E2E gate. Cached line lengths retain generated coordinates.
 */
export function rebaseCoverageProfileSources(profile, repositoryRoot) {
	if (!record(profile) || !Array.isArray(profile.result)) throw new TypeError('A coverage shard needs a V8 result array.');
	const root = resolve(repositoryRoot), originalCache = profile['source-map-cache'] ?? {};
	if (!record(originalCache)) throw new TypeError('A coverage shard has an invalid source-map cache.');
	const cache = {};
	for (const [url, entry] of Object.entries(originalCache)) {
		cache[url] = record(entry) && record(entry.data) && Array.isArray(entry.data.sources)
			? { ...entry, data: rebaseMapSources(entry.data, root) } : entry;
	}
	// No executable URL alias is needed for mapped entries: c8 reconstructs the
	// generated text from the existing cache. Reuse the portable source rebaser.
	return rebasePortableV8Profile({ ...profile, 'source-map-cache': cache }, { scripts: [] }, root, root);
}

function rebaseMapSources(map, root) {
	const sources = [...map.sources];
	const embedded = map.sourcesContent;
	const hashes = map.x_soundscaper_source_sha256;
	if (embedded !== undefined && (!Array.isArray(embedded) || embedded.length !== sources.length)
		|| hashes !== undefined && (!Array.isArray(hashes) || hashes.length !== sources.length)) {
		throw new Error('Coverage source-map proof has an invalid source inventory.');
	}
	const content = embedded === undefined ? undefined : [...embedded];
	for (const [index, source] of sources.entries()) {
		const path = ownedSourcePath(source, root);
		if (path === null || isGeneratedE2ERepositoryPath(path)) continue;
		const actualPath = localSource(root, path), localUrl = pathToFileURL(actualPath).href;
		// Some vendor maps escape node_modules into a checkout-looking src/ path
		// without supplying any original text/hash. Such absent placeholders are
		// not maintained source owners. Explicit portable repository claims remain strict.
		if (!source.startsWith(E2E_REPOSITORY_URL_PREFIX) && !existsSync(actualPath)
			&& hashes?.[index] == null && embedded?.[index] == null) continue;
		// Preserve ordinary local Node maps without inventing a new proof burden.
		// Relocated maps need the same text/hash proof the GPU coverage owner uses.
		if (source === localUrl && hashes === undefined) {
			sources[index] = actualPath;
			continue;
		}
		const text = readFileSync(actualPath, 'utf8'), digest = createHash('sha256').update(text).digest('hex');
		const supplied = embedded?.[index], expected = hashes?.[index];
		if (supplied !== undefined && supplied !== null && typeof supplied !== 'string'
			|| typeof supplied === 'string' && supplied !== text
			|| hashes !== undefined && expected !== digest
			|| typeof supplied !== 'string' && expected !== digest) {
			throw new Error(`Coverage has stale or unproved mapped source bytes: ${path}.`);
		}
		// Multi-source v8-to-istanbul applies c8's source exclusion before its final
		// URL resolution. A native path lets that check see the actual source scope.
		sources[index] = actualPath;
		if (content) content[index] = text;
	}
	return { ...map, sources, ...(content === undefined ? {} : { sourcesContent: content }) };
}

function ownedSourcePath(source, root) {
	if (typeof source !== 'string') return null;
	let parsed;
	try { parsed = new URL(source); } catch { return null; }
	if (parsed.protocol !== 'file:' || parsed.hostname !== '') return null;
	const pathname = decodeURIComponent(parsed.pathname);
	const rootPrefix = `${decodeURIComponent(new URL(pathToFileURL(root).href).pathname).replace(/\/$/u, '')}/`;
	const portablePrefix = '/__soundscaper_repo__/';
	let path;
	if (pathname.startsWith(portablePrefix)) path = pathname.slice(portablePrefix.length);
	else if (pathname.startsWith(rootPrefix)) path = pathname.slice(rootPrefix.length);
	else path = /^\/(?:home\/runner\/work|__w)\/([^/]+)\/\1\/(.*)$/u.exec(pathname)?.[2];
	// A nested functions/download/desktop route is not the root desktop tree.
	return typeof path === 'string' && /^(?:src|desktop)\//u.test(path)
		? `${path}${parsed.search}${parsed.hash}` : null;
}

function localSource(root, path) {
	const candidate = resolve(root, path), inside = relative(root, candidate);
	if (inside === '' || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)
		|| path.includes('\\') || path.split('/').some(part => part === '' || part === '.' || part === '..')) {
		throw new Error(`Coverage has an unsafe mapped source path: ${path}.`);
	}
	return candidate;
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
