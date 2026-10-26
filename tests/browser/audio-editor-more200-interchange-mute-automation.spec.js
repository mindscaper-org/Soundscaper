/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const mode of ['static', 'track', 'bus']) test(`cut export retains actually audible mute automation=${mode}`, async ({ page }, testInfo) => {
	test.setTimeout(90_000);
	const automated = mode !== 'static', bus = mode === 'bus';
	const source = createAudioSource({ id: 'tone', name: 'Voice.wav', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const base = createSoundscaperProject({ id: `automated-mute-${mode}`, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', mute: !bus, clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 })], });
	const mixer = bus ? { ...base.mixer, groups: [{ id: 'bus', name: 'Bus', color: '#808080', gain: 1, pan: 0, mute: true, solo: false, collapsed: false, effectsActive: true, effects: [], channelCount: 2 }],
		edges: [...base.mixer.edges.filter(edge => edge.source.kind !== 'track'),
			{ id: 'voice-to-bus', kind: 'assignment', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: 'bus' }, position: 'post-fader', level: 1, enabled: true, channelMap: [] },
			{ id: 'bus-to-master', kind: 'assignment', source: { kind: 'mixer-node', id: 'bus' }, destination: { kind: 'master' }, position: 'post-fader', level: 1, enabled: true, channelMap: [] }] } : base.mixer;
	const project = createSoundscaperProject({ ...base, mixer,
		automationLanes: automated ? [{ id: 'mute-ride', address: { kind: 'strip', strip: bus ? { kind: 'mixer-node', id: 'bus' } : { kind: 'track', id: 'voice' }, parameterId: 'mute' }, timebase: 'absolute-samples',
			points: [{ id: 'first', position: 0, value: 0 }, { id: 'last', position: 48_000, value: 0 }], segments: [{ kind: 'hold' }] }] : [] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: testInfo.testId }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 750 * frame / 48_000))]); await writer.commit();
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Mute.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file); await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const output = await exportSamples(page, editor); const peak = output.reduce((best, sample) => Math.max(best, Math.abs(sample)), 0);
	if (automated) expect(peak).toBeGreaterThan(.17); else expect(peak).toBeLessThan(.00001);
	const downloading = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const timeline = JSON.parse(Buffer.from(await downloadBytes(await downloading)).toString('utf8'));
	const clips = timeline.tracks.children.filter(track => track.kind === 'Audio').flatMap(track => track.children).filter(child => child.OTIO_SCHEMA === 'Clip.1');
	expect(clips).toHaveLength(automated ? 1 : 0);
	await chooseCommandAction(page, editor, 'File', 'Delivery Report');
	const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
	await expect(report.locator('[data-severity="warning"]').filter({ hasText: 'automation' })).toHaveCount(automated ? 1 : 0);
});
