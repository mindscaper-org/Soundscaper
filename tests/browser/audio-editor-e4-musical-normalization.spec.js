/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, commitInput, disableNativeSavePicker, waitForProjectActivation, openClipProperties, closeClipProperties } from './audio-editor-test-helpers.js';
import { readClipGain, chooseClipMediaSetting } from './audio-editor-clip-settings-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { measureBextLoudness } from '../../src/common/editor/broadcast-loudness.ts';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const bpm of [120, 240, 60]) test(`normalization measures the authored musical ${bpm}bpm recording`, async ({ page }) => {
	// At 60 BPM the authored programme doubles to eight seconds, rendered for
	// two exports and the normalization measurement on the browser's audio engine.
	if (bpm === 60) test.setTimeout(Math.max(test.info().timeout, 60_000));
	const pitchCents = 0;
	const errors = collectClientErrors(page);
	const tempoMap = { mode: 'musical', events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 192_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 192_000,
		anchor: 'musical', musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 8,
		pitchCents, speedRatio: 1, linkPitchAndTempo: false }, { projectSampleRate: 48_000, tempoMap });
	const project = createSoundscaperProject({ id: `musical-normalize-${bpm}`, tempoMap, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let start = 0; start < 192_000; start += 65_536) await writer.write([Float32Array.from({ length: Math.min(65_536, 192_000 - start) }, (_, frame) => .25 * Math.sin(2 * Math.PI * 100 * (start + frame) / 48_000))]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Musical.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file); await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Music']);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await commitInput(tempo, String(bpm)); await expect(tempo).toHaveValue(String(bpm));
	const baseline = Float32Array.from(await exportSamples(page, editor), sample => sample * Math.SQRT2);
	const baselineLufs = measureBextLoudness([baseline], 48_000).loudnessValue;
	expect(typeof baselineLufs).toBe('number');
	const properties = await openClipProperties(page, editor, editor.locator('[data-clip-id="clip"]').first(), { additional: false });
	await chooseClipMediaSetting(properties, 'Normalize to −14 LUFS');
	await expect.poll(() => readClipGain(properties)).not.toBe(0);
	const gain = await readClipGain(properties);
	console.log('musical normalization measurement', { bpm, baselineLufs, gain, expected: -14 - baselineLufs });
	expect(Math.abs(gain - (-14 - baselineLufs))).toBeLessThan(.2);
	await closeClipProperties(properties);
	const output = Float32Array.from(await exportSamples(page, editor), sample => sample * Math.SQRT2);
	expect(Math.abs(measureBextLoudness([output], 48_000).loudnessValue + 14)).toBeLessThan(.2);
	expect(errors).toEqual([]);
});
