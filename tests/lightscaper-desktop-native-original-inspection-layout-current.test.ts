/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeOriginalStoreCurrentV1 as Store } from '../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';

void test('Lightscaper native inspection refuses missing staging layout without declaring intact Original bytes missing', { timeout: 15_000 }, async t => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-inspection-layout-'));
	const store = await Store.open({ appDataPath }), bytes = Uint8Array.of(4, 8, 15, 16, 23, 42);
	const binding = { storageKey: 'retained-layout', contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
	try {
		await store.storeBinding(binding, (async function* () { yield bytes; })(), { signal: t.signal });
		await rm(paths(appDataPath).stagingRoot, { recursive: true });
		try { await assert.rejects(store.inspectBinding(binding, { signal: t.signal })); }
		finally { await mkdir(paths(appDataPath).stagingRoot, { mode: 0o700 }); }
		assert.deepEqual(await store.inspectBinding(binding, { signal: t.signal }), { status: 'present' });
	} finally { await store.close(); await rm(appDataPath, { recursive: true, force: true }); }
});
