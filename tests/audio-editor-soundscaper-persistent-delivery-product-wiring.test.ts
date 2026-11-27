/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDeliveryReport, sealDeliveryReport } from '../src/common/editor/delivery-report.ts';

import {
	bindSoundscaperPersistentDeliveryRuntime,
	type SoundscaperPersistentDeliveryExportRuntime,
} from '../src/common/editor/controller/export/soundscaper-persistent-delivery-runtime-binding.ts';

test('the closed common export seam binds the Soundscaper delivery runtime', () => {
	const received: SoundscaperPersistentDeliveryExportRuntime[] = [];
	let workspaceReport: unknown = null;
	const runtime = {
		exportService: {
			derivePersistentAudioDeliveryPlan: async () => ({ settings: {}, exportPlan: {} }),
			executePersistentAudioDeliveryPlan: async () => ({}),
			persistentAudioDeliveryAvailable: () => true,
			whenPersistentAudioDeliveryAvailable: async () => undefined,
		},
		getProject: () => null,
		getSaveState: () => 'saved',
		captureProjectGeneration: () => Object.freeze({ generation: 1, projectId: 'project' }),
		assertProjectGeneration: () => undefined,
		deliveryReport: () => workspaceReport,
		cancelExport: () => undefined,
		publishDocumentSnapshot: () => undefined,
	};
	bindSoundscaperPersistentDeliveryRuntime({
		bindSoundscaperPersistentDeliveryRuntime: (value: SoundscaperPersistentDeliveryExportRuntime) => { received.push(value); },
	}, runtime);
	const admitted = received[0];
	assert.ok(admitted);
	workspaceReport = { format: 'aup4', items: [], counts: {} };
	assert.equal(admitted.deliveryReport(), null);
	workspaceReport = sealDeliveryReport(createDeliveryReport({ format: 'wav' }));
	assert.equal(admitted.deliveryReport(), workspaceReport);

});

test('the common delivery seam has no product controller consumer', async () => {
	const [common, soundscaper, framescaper] = await Promise.all([
		readFile(new URL('../src/common/editor/app.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/soundscaper/editor-controller.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/framescaper/editor-controller.ts', import.meta.url), 'utf8'),
	]);
	assert.match(common, /bindSoundscaperPersistentDeliveryRuntime\(options,/u);
	assert.match(common, /cancelExport: cancelPersistentAudioDelivery/u);
	assert.doesNotMatch(common, /cancelExport:\s*\(\)\s*=>\s*handleExportAction\('cancel'\)/u);
	assert.doesNotMatch(soundscaper, /PersistentDelivery|persistentDelivery/u);
	assert.doesNotMatch(framescaper, /PersistentDelivery|persistentDelivery/u);
});

test('the retired persistent-delivery composition is absent from the source tree', async () => {
	const composition = new URL('../src/common/editor/controller/export/soundscaper-persistent-delivery-controller-composition.ts', import.meta.url);
	await assert.rejects(access(composition), { code: 'ENOENT' });
});
