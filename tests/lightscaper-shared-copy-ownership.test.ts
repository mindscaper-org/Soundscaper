/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { browserProductSiteForBuild } from '../scripts/lib/browser-product-site-plan.mjs';
import { assertLightscaperSharedCopyRequests } from './browser/helpers/lightscaper-shared-copy-ownership.ts';

const OWNERS = ['canonical-extras-standard-effects.js', 'editor-project-recovery-copy.ts',
	'editor-recording-recovery-copy.ts', 'canonical-extras.js', 'lightscaper-editor-copy.ts'];

/** Byte/map admission controls only; these fixtures do not execute a browser chunk. */
async function fixture(context: test.TestContext, owners = OWNERS) {
	const root = await mkdtemp(join(tmpdir(), 'light-shared-copy-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const site = browserProductSiteForBuild('lightscaper'), asset = 'assets/editor-copy-qualified.js';
	const directory = join(root, site.outputDirectory), mapDirectory = `${directory}-source-maps`;
	await mkdir(join(directory, 'assets'), { recursive: true }); await mkdir(mapDirectory);
	const body = Buffer.from('export const labels = true;\n');
	const map = Buffer.from(JSON.stringify({ version: 3, file: 'editor-copy-qualified.js',
		sources: owners.map(name => `file:///producer-checkout/src/common/i18n/${name}`), mappings: '' }));
	const pin = (bytes: Buffer) => ({ byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') });
	const metadata = { schemaVersion: 2, productId: 'lightscaper', origin: site.origin, sourceRevision: '1'.repeat(40),
		files: { [asset]: pin(body) }, sourceMaps: { 'editor-copy-qualified.js.map': pin(map) } };
	const bodyPath = join(directory, asset), mapPath = join(mapDirectory, 'editor-copy-qualified.js.map');
	const metadataPath = join(directory, '.browser-product-build.json');
	await writeFile(bodyPath, body); await writeFile(mapPath, map); await writeFile(metadataPath, JSON.stringify(metadata));
	return { root, bodyPath, mapPath, metadataPath, metadata, request: `${site.origin}/${asset}` };
}

test('authenticated shared copy admits the exact two recovery leaves alongside the existing photo labels', async context => {
	const f = await fixture(context);
	await assertLightscaperSharedCopyRequests([f.request, f.request], f.root);
});

for (const owner of ['catalogs.js', 'runtime.js', 'editor-copy-inventory.ts', 'framescaper-editor-copy.ts',
	'soundscaper-editor-copy.ts', 'editor-other-recovery-copy.ts']) {
	void test(`shared copy rejects authenticated foreign owner ${owner}`, async context => {
		const f = await fixture(context, [...OWNERS, owner]);
		await assert.rejects(assertLightscaperSharedCopyRequests([f.request], f.root), /Unexpected owner/u);
	});
}

for (const member of ['bodyPath', 'mapPath'] as const) void test(`shared copy rejects changed ${member} bytes`, async context => {
	const f = await fixture(context);
	const bytes = await readFile(f[member]); bytes[0] = bytes[0]! ^ 1;
	await writeFile(f[member], bytes);
	await assert.rejects(assertLightscaperSharedCopyRequests([f.request], f.root), /build evidence/u);
});

for (const identity of ['productId', 'origin'] as const) void test(`shared copy rejects foreign build ${identity}`, async context => {
	const f = await fixture(context);
	f.metadata[identity] = identity === 'productId' ? 'framescaper' : 'http://127.0.0.1:9999';
	await writeFile(f.metadataPath, JSON.stringify(f.metadata));
	await assert.rejects(assertLightscaperSharedCopyRequests([f.request], f.root));
});

test('a foreign origin cannot borrow the authenticated Lightscaper copy asset name', async context => {
	const f = await fixture(context), foreign = new URL(f.request); foreign.port = '9999';
	await assert.rejects(assertLightscaperSharedCopyRequests([foreign.href], f.root), /Lightscaper build origin/u);
});
