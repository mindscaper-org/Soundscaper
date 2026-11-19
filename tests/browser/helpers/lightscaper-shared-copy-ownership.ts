/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserProductSiteForBuild } from '../../../scripts/lib/browser-product-site-plan.mjs';
import { sourceMapDirectoryFor } from '../../../scripts/lib/build-source-map-relocation.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SHARED_RECOVERY = new Set(['editor-project-recovery-copy.ts', 'editor-recording-recovery-copy.ts']);
const PHOTO_COPY = /^(?:canonical-extras(?:-standard-effects)?\.js|lightscaper-[a-z-]+\.(?:ts|js))$/u;

/** Authenticate requested shared copy chunks before admitting their finite label owners.
 * The main worker effect contracts also use the two shared recovery-label leaves;
 * neither those labels nor Light copy admits the full editor catalog/runtime. */
export async function assertLightscaperSharedCopyRequests(requests: readonly string[], repositoryRoot = ROOT): Promise<void> {
	const site = browserProductSiteForBuild('lightscaper'), directory = resolve(repositoryRoot, site.outputDirectory);
	const metadata = record(JSON.parse(await readFile(resolve(directory, '.browser-product-build.json'), 'utf8')) as unknown);
	assert.equal(metadata.schemaVersion, 2); assert.equal(metadata.productId, 'lightscaper'); assert.equal(metadata.origin, site.origin);
	assert.ok(typeof metadata.sourceRevision === 'string' && /^[a-f0-9]{40}$/u.test(metadata.sourceRevision));
	const files = record(metadata.files), maps = record(metadata.sourceMaps);
	for (const request of new Set(requests)) {
		const url = new URL(request);
		if (!/^\/assets\/editor-copy-[^/]+\.js$/u.test(url.pathname)) continue;
		assert.equal(url.origin, site.origin, 'A shared copy request must belong to the Lightscaper build origin.');
		assert.equal(url.search, ''); assert.equal(url.hash, '');
		const asset = url.pathname.slice(1), mapName = `${basename(asset)}.map`;
		const bytes = await readFile(resolve(directory, asset));
		const mapBytes = await readFile(resolve(sourceMapDirectoryFor(directory), mapName));
		authenticate(bytes, files[asset]); authenticate(mapBytes, maps[mapName]);
		const map = record(JSON.parse(mapBytes.toString('utf8')) as unknown);
		assert.equal(map.version, 3); assert.ok(typeof map.file === 'string'); assert.equal(basename(map.file), basename(asset));
		assert.ok(Array.isArray(map.sources) && map.sources.length > 0);
		const sources: readonly unknown[] = map.sources;
		for (const source of sources) {
			assert.ok(typeof source === 'string');
			const path = (source.startsWith('file:') ? fileURLToPath(source) : source).replaceAll('\\', '/');
			const name = /\/src\/common\/i18n\/([^/]+)$/u.exec(path)?.[1];
			assert.ok(name !== undefined && (PHOTO_COPY.test(name) || SHARED_RECOVERY.has(name)),
				`Unexpected owner in authenticated Lightscaper shared copy chunk ${asset}: ${source}`);
		}
	}
}

function authenticate(bytes: Buffer, pin: unknown): void {
	const expected = record(pin);
	assert.equal(bytes.byteLength, expected.byteLength, 'Requested copy bytes differ from the build evidence length.');
	assert.equal(createHash('sha256').update(bytes).digest('hex'), expected.sha256, 'Requested copy bytes differ from the build evidence digest.');
}

function record(value: unknown): Record<string, unknown> {
	assert.ok(isRecord(value), 'Expected actual browser build/map evidence.'); return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
