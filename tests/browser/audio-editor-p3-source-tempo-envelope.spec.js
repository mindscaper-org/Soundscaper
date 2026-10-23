/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, commitInput, disableNativeSavePicker,
	openSourceMonitor, closeClipProperties, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

const peak = (samples, start, end) => samples.slice(Math.round(start * 48_000), Math.round(end * 48_000))
	.reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);

test('Source Change tempo keeps the clip gain notch on the same part of the recording and Undo restores it', async ({ page }) => {
	test.setTimeout(90_000);
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const envelope = [0, 12_000, 24_000, 36_000, 48_000].map((frame, index) => ({ frame, value: index === 1 || index === 2 ? 0 : 1 }));
	const clip = createAudioClip({ id: 'clip', title: 'Voice recording', sourceId: source.id, envelope,
		durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id: 'p3-source-envelope', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 750 * frame / 48_000))]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor);
	expect(before.length).toBe(48_000); expect(peak(before, .35, .4)).toBeLessThan(.0001);
	expect(peak(before, .8, .85)).toBeGreaterThan(.1);
	const properties = await openSourceMonitor(page, editor, clipByName(editor, clip.title));
	const waveform = properties.getByRole('region', { name: 'Source waveform', exact: true });
	await waveform.focus(); await waveform.press('Control+a');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Change tempo']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await commitInput(dialog.locator('[data-effect-param="effectAudacityFromBpm"] input'), '120');
	await commitInput(dialog.locator('[data-effect-param="effectAudacityToBpm"] input'), '240');
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 20_000 }); await closeClipProperties(properties);
	const processed = await exportSamples(page, editor);
	expect(processed.length).toBe(24_000);
	expect(peak(processed, .175, .225)).toBeLessThan(.0001);
	expect(peak(processed, .4, .45)).toBeGreaterThan(.1);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); const undone = await exportSamples(page, editor);
	expect(undone.length).toBe(before.length);
	expect(undone.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - before[frame])), 0)).toBeLessThan(.000001);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); const redone = await exportSamples(page, editor);
	expect(redone.length).toBe(processed.length); expect(peak(redone, .175, .225)).toBeLessThan(.0001);
});
