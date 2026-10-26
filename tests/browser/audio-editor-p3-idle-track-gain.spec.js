/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseDropdown, chooseExportProjectFileAction, closeDialog, disableNativeSavePicker,
	downloadBytes, openExportDialog, readDownloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { strFromU8, unzipSync } from 'fflate';

for (const gain of [0, .0001, 4]) test(`an idle track volume thumb preserves native gain ${gain} and delivered PCM`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, channelCount: 1, frameCount: 48_000 });
	const clip = createAudioClip({ id: 'clip', title: 'Voice', sourceId: source.id, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id: `p3-idle-track-${String(gain)}`, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id], gain })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Precise track.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportFloatSamples(page, editor);
	const range = editor.locator('[data-track-row]').first().getByRole('slider', { name: 'Volume', exact: true });
	await range.evaluate(input => { input.dataset.changes = '0'; input.addEventListener('input', () => { input.dataset.changes = String(Number(input.dataset.changes) + 1); }); });
	const box = await range.boundingBox(); expect(box).not.toBeNull();
	const fraction = Number(await range.inputValue()) / 100;
	await page.mouse.click(box.x + 8 + fraction * (box.width - 16), box.y + box.height / 2);
	await expect(range).toHaveAttribute('data-changes', '0');
	const downloaded = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await downloaded)); const saved = JSON.parse(strFromU8(files['project.json']));
	expect(saved.tracks[0].gain).toBe(gain);
	const after = await exportFloatSamples(page, editor);
	expect(after.length).toBe(before.length);
	expect(after.reduce((maximum, sample, frame) => Math.max(maximum, Math.abs(sample - before[frame])), 0)).toBeLessThan(.00000001);
	await range.focus(); await range.press(gain === 4 ? 'ArrowLeft' : 'ArrowRight');
	const changed = await exportFloatSamples(page, editor);
	expect(Math.abs(changed[24_000] - before[24_000])).toBeGreaterThan(.00001);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const undone = await exportFloatSamples(page, editor); expect(undone[24_000]).toBe(before[24_000]);
});

async function exportFloatSamples(page, editor) {
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="bitDepth"]'), '32-bit Float');
	const link = dialog.locator('[data-export-download]');
	const previous = await link.count() ? await link.getAttribute('href') : null;
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect(link).toBeVisible({ timeout: 20_000 });
	await expect.poll(() => link.getAttribute('href')).not.toBe(previous);
	const bytes = await readDownloadBytes(page, link);
	const samples = await page.evaluate(async data => {
		const context = new AudioContext({ sampleRate: 48_000 });
		try { return Array.from((await context.decodeAudioData(new Uint8Array(data).buffer)).getChannelData(0)); }
		finally { await context.close(); }
	}, Array.from(bytes));
	await closeDialog(dialog);
	return samples;
}
