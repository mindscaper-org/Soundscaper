/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createExportPlan } from '../src/common/editor/export.js';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { prepareImportedWavMetadata } from '../src/common/editor/controller/import/internal/wav-import-metadata.ts';
import { freezeProjectImportOptions, normalizeProjectImportOptions } from '../src/common/editor/controller/import/internal/project-import-options.ts';

test('a CART script containing ASCII tabs retains its continuity metadata on WAV import and delivery', async () => {
	const script = 'HOST\tRead the station identification.\r\n';
	const bytes = encodeWav([new Float32Array(48)], { sampleRate: 48_000,
		cart: { title: 'Station identification', cutId: 'ID-001', tagText: script.replace('\t', ' '),
			postTimers: [{ usage: 'EOD ', value: 48 }] } });
	const textOffset = Buffer.from(bytes).indexOf('HOST Read the station identification.');
	assert.ok(textOffset > 0);
	bytes[textOffset + 4] = 9;
	const imported = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	assert.ok(imported);
	assert.equal(imported.cart?.title, 'Station identification');
	assert.equal(imported.cart?.tagText, script);
	assert.deepEqual(imported.cart?.postTimers, [{ usage: 'EOD ', value: 48 }]);
	const delivered = encodeWav([new Float32Array(48)], { sampleRate: 48_000, cart: imported.cart });
	const reread = await inspectWavBlobPcm(new Blob([Uint8Array.from(delivered)]));
	assert.ok(reread);
	assert.equal(reread.cart?.tagText, script);
});

test('CART reference calibration follows the delivered PCM sample width', async () => {
	const original = encodeWav([new Float32Array([0.5])], { sampleRate: 48_000, bitDepth: 16,
		cart: { title: 'Calibrated radio spot', levelReference: 16_384 } });
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(original)]));
	assert.ok(descriptor?.cart);
	const project = createCurrentAudioEditorProject({ id: 'calibrated', sampleRate: 48_000 });
	const imported = prepareImportedWavMetadata({ descriptor, project, projectSampleRate: 48_000, copy: {},
		importOptions: normalizeProjectImportOptions({ destination: 'timeline' }, 'Invalid frames.'),
		freezeImportOptions: freezeProjectImportOptions });
	const promoted = createCurrentAudioEditorProject({ ...project, metadata: { cart: imported.projectCart } });
	for (const [sampleFormat, expected] of [['int16', 16_384], ['int20', 4_194_304], ['int24', 4_194_304]] as const) {
		const plan = createExportPlan(promoted, { format: 'bwf', sampleFormat, range: { startFrame: 0, endFrame: 1 } });
		assert.equal(plan.cart?.levelReference, expected);
		const delivered = encodeWav([new Float32Array([0.5])], { ...plan, cart: plan.cart });
		const reread = await inspectWavBlobPcm(new Blob([Uint8Array.from(delivered)]));
		assert.ok(reread?.cart);
		assert.equal(reread.cart.levelReference, expected);
	}
	assert.equal(descriptor.cart.levelReference, 16_384);
});

test('floating-point CART calibration retains its sample unit through saved project metadata', async () => {
	const bytes = encodeWav([new Float32Array([0.5])], { sampleRate: 48_000, float: true,
		cart: { levelReference: 1 } });
	const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	assert.ok(descriptor?.cart);
	const project = createCurrentAudioEditorProject({ id: 'float-reference', sampleRate: 48_000 });
	const imported = prepareImportedWavMetadata({ descriptor, project, projectSampleRate: 48_000, copy: {},
		importOptions: normalizeProjectImportOptions({ destination: 'timeline' }, 'Invalid frames.'),
		freezeImportOptions: freezeProjectImportOptions });
	const persisted = JSON.parse(JSON.stringify({ ...project, metadata: { cart: imported.projectCart } })) as unknown;
	const restored = createCurrentAudioEditorProject(persisted);
	const plan = createExportPlan(restored, { format: 'bwf', sampleFormat: 'int24', range: { startFrame: 0, endFrame: 1 } });
	assert.equal(plan.cart?.levelReference, 8_388_608);
});
