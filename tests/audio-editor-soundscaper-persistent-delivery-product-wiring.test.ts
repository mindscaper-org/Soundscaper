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

test('the retired persistent-delivery private transport is absent from the source tree', async () => {
	const transport = new URL('../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-private-transport.ts', import.meta.url);
	await assert.rejects(access(transport), { code: 'ENOENT' });
});

test('the retired persistent-delivery worker is absent from the source tree', async () => {
	const worker = new URL('../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-worker.ts', import.meta.url);
	await assert.rejects(access(worker), { code: 'ENOENT' });
});

test('the retired persistent-delivery queue mirror is absent from the source tree', async () => {
	const mirror = new URL('../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-ui-service.ts', import.meta.url);
	await assert.rejects(access(mirror), { code: 'ENOENT' });
});

test('the retired persistent-delivery adapter and publication guard are absent from the source tree', async () => {
	const adapter = new URL('../src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-adapter-v1.ts', import.meta.url);
	const publication = new URL('../src/common/editor/controller/export/internal/delivery/soundscaper-delivery-publication-v1.ts', import.meta.url);
	await assert.rejects(access(adapter), { code: 'ENOENT' });
	await assert.rejects(access(publication), { code: 'ENOENT' });
});

test('the retired persistent export branch is absent from the source tree', async () => {
	const saveTarget = new URL('../src/common/editor/soundscaper-persistent-delivery-save-target.ts', import.meta.url);
	await assert.rejects(access(saveTarget), { code: 'ENOENT' });
	const directory = new URL('../src/common/editor/controller/export/internal/', import.meta.url);
	for (const path of ['delivery/persistent-audio-delivery-execution.ts', 'delivery/persistent-export-progress.ts', 'export-operation-availability.ts']) {
		await assert.rejects(access(new URL(path, directory)), { code: 'ENOENT' });
	}
});
