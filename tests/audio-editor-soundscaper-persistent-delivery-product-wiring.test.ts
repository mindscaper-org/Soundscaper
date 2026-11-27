/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('controller composition omits the retired persistent-delivery seam', async () => {
	const [common, options, soundscaper, framescaper] = await Promise.all([
		readFile(new URL('../src/common/editor/app.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/common/editor/controller/composition/controller-options.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/soundscaper/editor-controller.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/framescaper/editor-controller.ts', import.meta.url), 'utf8'),
	]);
	assert.equal(common.includes('bindSoundscaperPersistentDeliveryRuntime'), false);
	assert.equal(options.includes('bindSoundscaperPersistentDeliveryRuntime'), false);
	assert.doesNotMatch(soundscaper, /PersistentDelivery|persistentDelivery/u);
	assert.doesNotMatch(framescaper, /PersistentDelivery|persistentDelivery/u);
});

test('the retired persistent-delivery composition and binding are absent from the source tree', async () => {
	const composition = new URL('../src/common/editor/controller/export/soundscaper-persistent-delivery-controller-composition.ts', import.meta.url);
	const binding = new URL('../src/common/editor/controller/export/soundscaper-persistent-delivery-runtime-binding.ts', import.meta.url);
	await assert.rejects(access(composition), { code: 'ENOENT' });
	await assert.rejects(access(binding), { code: 'ENOENT' });
});
