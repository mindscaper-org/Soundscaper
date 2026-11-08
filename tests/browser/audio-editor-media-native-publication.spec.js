/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { authoredWildcardResponseHeaders } from '../../scripts/lib/static-response-headers.mjs';
import { installNativeOpfsWorkerCompanion, assertNativeOpfsWorkerExecution } from './helpers/native-opfs-worker-companion.ts';

// The routed esbuild test program is not the emitted production application.
test.use({ browserCoverage: false });
test.setTimeout(15_000);
const ROOT = '/__video_storage_native_publication__';
const CASES = {
	concurrent: { fulfilled: 1, rejected: 1, files: 1, rows: 1 },
	adversarial: { sha256: 'ddc5852cf5d92b542ec7d6efcc6d9c02a53f9692fd5f36e954896c21c7a8ac4e', physicalBytes: 'original-video', overriddenBytes: 'forged-content', files: 1 },
	cascade: { before: 3, afterMediaDelete: 1, afterSourceDelete: 0 },
	trim: { before: 4, after: 2, removedEntries: 2, removedBytes: 15, pcmFrames: 1 },
	cancel: { writes: 1, stagedFile: true, exactReason: true, published: false, files: 0 },
};
for (const [mode, expected] of Object.entries(CASES)) test(`native whole-Blob media ${mode} preserves actual OPFS custody`, async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', 'Native OPFS/sync-worker qualification is maintained for Chromium and Firefox; WebKit has separate IndexedDB fallback coverage.');
	await installNativeOpfsWorkerCompanion(page);
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../helpers/video-storage-native-publication-fixture.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	const headers = authoredWildcardResponseHeaders();
	await page.route(new RegExp(`${ROOT}/(?:index\\.html|entry\\.js)$`, 'u'), async route => {
		const html = route.request().url().endsWith('/index.html');
		await route.fulfill({ contentType: html ? 'text/html' : 'text/javascript', headers,
			body: html ? '<!doctype html><title>Actual native OPFS direct media publication</title>' : bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	const result = await page.evaluate(async ({ root, mode }) => (await import(`${root}/entry.js`)).qualifyVideoStorageNativePublication(mode), { root: ROOT, mode });
	expect(result).toMatchObject({ mode, nativeOpfs: true, nativeDatabase: true, ...expected });
	if (mode === 'concurrent') expect(['first', 'second']).toContain(result.winner);
	await assertNativeOpfsWorkerExecution(page);
});
