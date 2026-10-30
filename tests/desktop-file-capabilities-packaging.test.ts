/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { bundleDesktopFileCapabilities } from '../scripts/lib/desktop-product-runtime-staging.mjs';
import { assertStagedDesktopImportsResolve } from '../scripts/lib/desktop-staged-import-hygiene.mjs';

test('packaged read capabilities retain exact original identities without a TypeScript loader', async context => {
	const applicationRoot = await mkdtemp(join(tmpdir(), 'desktop-file-capabilities-'));
	context.after(() => rm(applicationRoot, { recursive: true, force: true }));
	const sourceRoot = resolve(import.meta.dirname, '../desktop');
	for (const name of ['constants.js', 'product.json', 'read-capability-admission.js',
		'read-capability-range-stream.js', 'read-capability-request-lease.js',
		'read-capability-support.js', 'validation.js']) {
		await cp(join(sourceRoot, name), join(applicationRoot, name));
	}
	await writeFile(join(applicationRoot, 'package.json'), JSON.stringify({ type: 'module' }));
	await writeFile(join(applicationRoot, 'original.wav'), 'original media');
	await bundleDesktopFileCapabilities(sourceRoot, applicationRoot);
	await assertStagedDesktopImportsResolve(applicationRoot);

	for (const productId of ['soundscaper', 'framescaper']) {
		const result = spawnSync(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '--eval', `
			import assert from 'node:assert/strict';
			import { stat } from 'node:fs/promises';
			import { resolve } from 'node:path';
			import { ReadCapabilityStore } from './file-capabilities.js';
			const path = resolve('original.wav');
			const exact = await stat(path, { bigint: true });
			const owner = {};
			const store = new ReadCapabilityStore();
			try {
				const read = await store.registerMaterializedPath(path, { owner });
				assert.ok(read.url.startsWith(process.env.SCAPE_PRODUCT + '-app://bundle/'));
				const grant = await store.resolveOriginalFileGrant(read.id, { owner });
				assert.deepEqual(grant, { path, identity: { dev: exact.dev, ino: exact.ino,
					size: exact.size, mtimeNs: exact.mtimeNs, ctimeNs: exact.ctimeNs } });
				assert.ok(Object.isFrozen(grant.identity));
				assert.equal(await store.resolveOriginalFileGrant(read.id, { owner: {} }), null);
				const helper = await store.resolveHelperGrant(read.id, { owner });
				assert.equal(helper.path, path);
				assert.equal(helper.size, Number(exact.size));
			} finally {
				await store.dispose();
			}
		`], {
			cwd: applicationRoot,
			env: { ...process.env, NODE_OPTIONS: '', SCAPE_PRODUCT: productId },
			encoding: 'utf8',
		});
		assert.ifError(result.error);
		assert.equal(result.status, 0, result.stderr);
	}
});
