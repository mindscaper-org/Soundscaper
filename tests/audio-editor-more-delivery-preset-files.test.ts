/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { importDeliveryPresets } from '../src/common/editor/delivery-preset-store.ts';
import { presetSettingsFromDialog, dialogSettingsFromPreset } from '../src/common/editor/ui/export-preset-model.ts';
import { createVideoExportPlan, resolveVideoExportCanvas } from '../src/common/editor/video-export.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { mountedExportDialog } from './helpers/audio-editor-export-dialog-fixture.ts';
import type { ReactTestElement } from './helpers/react-test-dom.ts';

function imported(settings: Readonly<Record<string, unknown>>) {
	return importDeliveryPresets({}, JSON.stringify({ schemaVersion: 1, presets: [{
		schemaVersion: 1, id: 'video', label: 'Imported video', kind: 'video', format: 'mp4', settings,
	}] })).presets[0]!;
}

async function requestFromFile(settings: Readonly<Record<string, unknown>>) {
	const fixture = await mountedExportDialog({ video: true, presets: [imported(settings)] });
	try {
		await fixture.chooseFormat(ENGLISH_COPY.videoExportMp4);
		await selectPreset(fixture, 'Imported video');
		await fixture.startExport();
		assert.equal(fixture.requests.length, 1);
		return fixture.requests[0]!;
	} finally { await fixture.unmount(); }
}

async function selectPreset(fixture: Awaited<ReturnType<typeof mountedExportDialog>>, label: string) {
	const trigger = fixture.dom.one('[data-delivery-preset-bar]').querySelector('.dropdown__trigger');
	assert.ok(trigger);
	await fixture.click(trigger);
	const choice = (document.body as unknown as ReactTestElement).querySelectorAll('[role="option"]')
		.find(node => node.textContent.includes(label));
	assert.ok(choice);
	await fixture.click(choice);
}

function project() {
	return { sampleRate: 48_000, clips: [{ kind: 'video', id: 'clip', sourceId: 'source', title: 'Camera',
		timelineStartFrame: 0, sourceStartFrame: 0, sourceDurationFrames: 48_000, durationFrames: 48_000 }],
		sources: [{ kind: 'video', id: 'source', storageKey: 'source', name: 'Camera.mp4', mimeType: 'video/mp4',
			frameCount: 48_000, sampleRate: 48_000, width: 1920, height: 1080, frameRate: 60,
			videoCodec: 'h264', hasAudio: false }], tracks: [{ id: 'video', type: 'video', clipIds: ['clip'] }] };
}

test('a video preset imported from a file keeps its no-audio delivery in the dialog request', async () => {
	const request = await requestFromFile({ includeAudio: false });
	const plan = createVideoExportPlan(project(), { ...request, format: 'mp4', range: { startFrame: 0, endFrame: 48_000 } });
	assert.equal(plan.codecs.audio, null);
	assert.equal(plan.inputs.some((input: { kind: string }) => input.kind === 'staged-audio-mix'), false);
	const saved = presetSettingsFromDialog(dialogSettingsFromPreset(imported({ includeAudio: false })), 'video');
	assert.equal(saved.includeAudio, false);
});

test('imported automatic video size and rate limits survive the dialog and saved preset', async () => {
	const limits = { maximumWidth: 640, maximumHeight: 360, maximumFrameRate: { num: 24_000, den: 1_001 } };
	const request = await requestFromFile(limits);
	const canvas = resolveVideoExportCanvas(project(), request.canvas);
	assert.deepEqual([canvas.width, canvas.height], [640, 360]);
	assert.equal(canvas.frameRate, 24_000 / 1_001);
	assert.deepEqual(presetSettingsFromDialog(dialogSettingsFromPreset(imported(limits)), 'video'), limits);
});

test('an imported audio preset with omitted settings restores its defaults after a different preset', async () => {
	const presets = importDeliveryPresets({}, JSON.stringify({ schemaVersion: 1, presets: [
		{ schemaVersion: 1, id: 'telephone', label: 'Telephone', kind: 'audio', format: 'wav',
			settings: { sampleRate: 16_000, sampleFormat: 'int16', channelMapping: 'mono', dither: 'none', includeTail: false, mode: 'clips' } },
		{ schemaVersion: 1, id: 'default', label: 'Default WAV', kind: 'audio', format: 'wav', settings: {} },
	] })).presets;
	const fixture = await mountedExportDialog({ presets });
	try {
		await selectPreset(fixture, 'Telephone');
		await selectPreset(fixture, 'Default WAV');
		await fixture.startExport();
		const request = fixture.requests[0]!;
		assert.equal(request.sampleRate, 48_000);
		assert.equal(request.sampleFormat, 'int24');
		assert.equal(request.channelMapping, 'preserve');
		assert.equal(request.dither, 'triangular');
		assert.equal(request.includeTail, true);
		assert.equal(request.mode, 'mix');
	} finally { await fixture.unmount(); }
});
