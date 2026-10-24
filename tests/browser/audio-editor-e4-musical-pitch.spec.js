/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, commitInput, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const [bpm, pitchCents] of [[120, 1200], [240, 1200], [240, 0]]) test(`beat-anchored ${bpm}bpm audio retains independent ${pitchCents}cents pitch`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const tempoMap = { mode: 'musical', events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }] };
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: 0, sourceDurationFrames: 48_000,
		anchor: 'musical', musicalStartBeat: 0, musicalExtent: 'beat', musicalDurationBeats: 2,
		pitchCents, speedRatio: 1, linkPitchAndTempo: false }, { projectSampleRate: 48_000, tempoMap });
	const project = createSoundscaperProject({ id: `musical-pitch-${bpm}`, tempoMap, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000))]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Musical.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file); await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Workspace', 'Music']);
	const tempo = editor.getByRole('spinbutton', { name: 'Project tempo (BPM)', exact: true });
	await commitInput(tempo, String(bpm)); await expect(tempo).toHaveValue(String(bpm));
	const samples = await exportSamples(page, editor);
	expect(samples).toHaveLength(48_000 * 120 / bpm);
	const magnitude = frequency => {
		let real = 0, imaginary = 0;
		for (let frame = 6000; frame < 18000; frame++) {
			const phase = 2 * Math.PI * frequency * frame / 48_000;
			real += samples[frame] * Math.cos(phase); imaginary += samples[frame] * Math.sin(phase);
		}
		return Math.hypot(real, imaginary) / 6000;
	};
	const expectedFrequency = pitchCents ? 2000 : 1000;
	expect(magnitude(expectedFrequency)).toBeGreaterThan(.1); expect(magnitude(expectedFrequency * 2)).toBeLessThan(.01);
	expect(errors).toEqual([]);
});
