/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { createSpatialExportRenderProject } from '../src/common/editor/controller/export/internal/spatial-render-project.ts';
import { normalizeEditorExportSettings } from '../src/common/editor/controller/export/export-settings.ts';
import { createDeliveryReportForPlan } from '../src/common/editor/delivery-conversion-inventory.ts';
import { changeSpatialExportSetting } from '../src/common/editor/ui/ear-export-settings.ts';
import { exportDialogOutputChannelCount, normalizeExportDialogAudioSettings } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { validateDeliveryPreset } from '../src/common/editor/delivery-preset.ts';
import { presetSettingsFromDialog, dialogSettingsFromPreset } from '../src/common/editor/ui/export-preset-model.ts';

function project() {
	return createSoundscaperProject({ id: 'ear-export', title: 'EAR export', masterChannels: 2,
		sources: [{ id: 'source', storageKey: 'source', frameCount: 100, channelCount: 1, sampleRate: 48_000 }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: 100 }],
		tracks: [{ id: 'voice', type: 'audio', name: 'Voice', clipIds: ['clip'] }],
	});
}
const adm = { mode: 'authored', programme: { name: 'Programme', language: 'eng' }, content: { name: 'Content', language: 'eng' }, bed: { name: 'Bed', layout: 'mono', assignments: [
	{ stripKind: 'track', stripId: 'voice', sourceChannel: 0, bedChannel: 'M' },
] } };

test('EAR captures the authored programme and declares the delivered speaker layout', () => {
	const source = project();
	const plan = createExportPlan(source, { format: 'wav', earLayout: '7.1.4', adm, includeTail: false });
	assert.equal(plan.channelCount, 12);
	assert.equal(plan.ear?.sourceChannelCount, 1);
	assert.equal(plan.adm, undefined, 'speaker PCM carries no stale ADM channel metadata');
	assert.equal(plan.container, undefined);
	assert.equal(plan.encoding.channelMapping.mode, 'preserve');
	const capture = createSpatialExportRenderProject(source, plan);
	assert.equal(capture.masterChannels, 1);
	assert.equal(source.masterChannels, 2);
	assert.equal(capture.metadata.adm?.mode, 'authored');
	const report = createDeliveryReportForPlan(plan, { sampleRate: 48_000 });
	const item = report.items.find(({ code }) => code === 'delivery.ear-render');
	assert.equal(item?.data?.renderer, 'ebu-libear');
	assert.equal(item?.data?.layout, '7.1.4');
	assert.equal(item?.data?.sourceChannels, 1);
	assert.equal(item?.data?.outputChannels, 12);
});

test('EAR refuses missing routes, unsupported layouts and realtime fallback', () => {
	const source = project();
	assert.throws(() => createExportPlan(source, { earLayout: '5.1', adm: { ...adm, bed: { ...adm.bed, assignments: [] } } }), /routing/u);
	assert.throws(() => createExportPlan(source, { earLayout: '5.1', adm, livePcmBytes: 2 * 1024 ** 3 }), /offline/u);
	assert.throws(() => normalizeEditorExportSettings({ earLayout: 'invalid' }, 48_000), /layout/u);
	assert.equal(normalizeEditorExportSettings({ earLayout: '5.1' }, 48_000).earLayout, '5.1');
	assert.deepEqual(normalizeEditorExportSettings({ earLayout: '5.1', adm }, 48_000).adm, adm);
	const plan = createExportPlan(source, { earLayout: '7.1', adm, loudnessNormalization: 'ebu-r128' });
	assert.deepEqual(plan.loudnessChannelWeights, [1, 1, 1, 0, Math.SQRT2, Math.SQRT2, 1, 1]);
});

test('the dialog and saved presets preserve the explicit EAR choice and retire incompatible modes', () => {
	const settings = { ...createExportDialogInitialSettings(project()), adm, earLayout: '5.1.4' };
	const request = createExportDialogRequest(settings, {});
	assert.equal(request.earLayout, '5.1.4');
	assert.deepEqual(request.adm, adm);
	assert.equal(exportDialogOutputChannelCount(settings, 1), 10);
	assert.equal(changeSpatialExportSetting(settings, 'binaural', true).earLayout, '');
	assert.equal(changeSpatialExportSetting({ ...settings, binaural: true }, 'earLayout', 'stereo').binaural, false);
	for (const incompatible of [{ mode: 'stems' }, { format: 'bw64' }, { format: 'video-mp4' }]) {
		assert.equal(normalizeExportDialogAudioSettings({ ...settings, ...incompatible }, false).earLayout, '');
	}
	const saved = validateDeliveryPreset({ schemaVersion: 1, id: 'ear', label: 'EAR', kind: 'audio', format: 'wav',
		settings: presetSettingsFromDialog(settings, 'audio') });
	assert.equal(saved.settings.earLayout, '5.1.4');
	assert.equal(dialogSettingsFromPreset(saved).earLayout, '5.1.4');
	assert.throws(() => validateDeliveryPreset({ ...saved, settings: { earLayout: 'invalid' } }), /layout/u);
});

test('EAR preserves next loop rendering, export defaults and both preset settings', () => {
	const source = { ...project(), loop: { enabled: true, startFrame: 10, endFrame: 90 } };
	const settings = { ...createExportDialogInitialSettings(source), adm, earLayout: '5.1', range: 'loop', renderAsLoop: true };
	assert.equal(settings.dither, 'none');
	assert.equal(settings.includeTail, false);
	const request = createExportDialogRequest(settings, {});
	const plan = createExportPlan(source, request);
	assert.equal(plan.renderAsLoop, true);
	assert.equal(plan.outputFrames, 80);
	assert.equal(plan.channelCount, 6);
	const codes = createDeliveryReportForPlan(plan, { sampleRate: source.sampleRate }).items.map(({ code }) => code);
	assert.ok(codes.includes('delivery.loop-wrap'));
	assert.ok(codes.includes('delivery.ear-render'));
	const saved = presetSettingsFromDialog(settings, 'audio');
	assert.equal(saved.renderAsLoop, true);
	assert.equal(saved.earLayout, '5.1');
});
