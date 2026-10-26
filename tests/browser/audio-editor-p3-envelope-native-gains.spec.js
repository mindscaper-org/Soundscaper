/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, disableNativeSavePicker, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { addClipGainPoint, persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

const peak = samples => samples.slice(38_400, 43_200).reduce((maximum, sample) => Math.max(maximum, Math.abs(sample)), 0);

test('editing a clip gain point keeps untouched native gain and the supported twelve dB drag range', async ({ page }) => {
	test.setTimeout(90_000);
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'clip', title: 'Voice recording', sourceId: source.id,
		durationFrames: 48_000, sourceDurationFrames: 48_000,
		envelope: [{ frame: 0, value: 1 }, { frame: 9600, value: 1 }, { frame: 33_600, value: 16 }, { frame: 48_000, value: 16 }] });
	const project = createSoundscaperProject({ id: 'p3-envelope-gain', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .01 * Math.sin(2 * Math.PI * 750 * frame / 48_000))]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Voice.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(peak(before)).toBeGreaterThan(.1);
	const recording = clipByName(editor, clip.title);
	await addClipGainPoint(page, editor, recording, .1);
	await expect.poll(async () => (await persistedProject(page, project.id))?.clips[0]?.envelope?.length, { timeout: 15_000 }).toBe(5);
	const afterAdd = await exportSamples(page, editor);
	expect(Math.abs(peak(afterAdd) - peak(before))).toBeLessThan(.000001);
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const envelope = recording.locator('.envelope-overlay');
	if (!await envelope.isVisible()) await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const point = envelope.locator('.envelope-point').nth(1), bounds = await point.boundingBox(), area = await envelope.boundingBox();
	expect(bounds).not.toBeNull(); expect(area).not.toBeNull();
	await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width / 2, area.y, { steps: 5 }); await page.mouse.up();
	await expect.poll(async () => (await persistedProject(page, project.id))?.clips[0]?.envelope
		?.find(item => item.frame > 0 && item.frame < 9600)?.value).toBeGreaterThan(3.5);
	const afterDrag = await exportSamples(page, editor);
	expect(Math.abs(peak(afterDrag) - peak(before))).toBeLessThan(.000001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo'); await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(async () => (await persistedProject(page, project.id))?.clips[0]?.envelope).toEqual(clip.envelope);
	await chooseCommandAction(page, editor, 'Edit', 'Redo'); await chooseCommandAction(page, editor, 'Edit', 'Redo');
	const redone = await exportSamples(page, editor); expect(Math.abs(peak(redone) - peak(before))).toBeLessThan(.000001);
});
