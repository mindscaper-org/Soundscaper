/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
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

test('production wiring selects persistence only inside the Soundscaper product owner', async () => {
	const [common, soundscaper, framescaper] = await Promise.all([
		readFile(new URL('../src/common/editor/app.js', import.meta.url), 'utf8'),
		readFile(new URL('../src/soundscaper/editor-controller.ts', import.meta.url), 'utf8'),
		readFile(new URL('../src/framescaper/editor-controller.ts', import.meta.url), 'utf8'),
	]);
	assert.match(common, /bindSoundscaperPersistentDeliveryRuntime\(options,/u);
	assert.match(common, /cancelExport: cancelPersistentAudioDelivery/u);
	assert.doesNotMatch(common, /cancelExport:\s*\(\)\s*=>\s*handleExportAction\('cancel'\)/u);
	assert.match(soundscaper, /createSoundscaperPersistentDeliveryControllerComposition/u);
	assert.match(soundscaper, /persistentDelivery/u);
	assert.doesNotMatch(framescaper, /PersistentDelivery|persistentDelivery/u);
});
