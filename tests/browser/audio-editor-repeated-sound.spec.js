/* SPDX-License-Identifier: AGPL-3.0-only */

import { strFromU8, unzipSync } from 'fflate';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseExportProjectFileAction, disableNativeSavePicker,
	downloadBytes, importFiles } from './audio-editor-test-helpers.js';

function recording() {
	const file = createWavFixture({ name: 'repeated-jingle.wav', frequency: 0, duration: 3, channelCount: 1 });
	let seed = 123;
	const marker = Array.from({ length: 4800 }, () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return Math.round((seed / 2 ** 32 - .5) * 18000);
	});
	for (const [offset, gain] of [[24_000, 1], [72_000, .5]]) {
		for (let index = 0; index < marker.length; index++) file.buffer.writeInt16LE(Math.round(marker[index] * gain), 44 + (offset + index) * 2);
	}
	return file;
}

async function program(page, editor, source) {
	await chooseCommandAction(page, editor, 'Tools', 'Macros palette');
	const palette = page.getByRole('dialog', { name: 'Macros palette', exact: true });
	await palette.getByRole('button', { name: 'New program', exact: true }).click();
	await palette.getByRole('textbox', { name: 'Program', exact: true }).fill(source);
	await palette.getByRole('button', { name: 'Run program', exact: true }).click();
	await expect(palette.locator('[data-macro-script-log]')).toHaveAttribute('data-outcome', 'completed');
	await palette.getByRole('button', { name: 'Close', exact: true }).click();
}

const selectExample = [
	"const tracks = (await sound.project.tracks()).filter(track => track.kind === 'audio');",
	'const trackId = tracks.at(-1).id;',
	'await sound.select.frames(24000, 28800, { trackIds: [trackId] });',
].join('\n');

async function savedProject(page, editor) {
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const files = unzipSync(await downloadBytes(await downloading));
	return JSON.parse(strFromU8(files['project.json']));
}

test('Analyze > Find repeated sound labels the example and a quieter copy, with undo and save', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [recording()]);
	await program(page, editor, selectExample);
	await chooseCommandAction(page, editor, 'Analyze', 'Find repeated sound');
	const dialog = page.getByRole('dialog', { name: 'Find repeated sound', exact: true });
	await dialog.getByRole('spinbutton', { name: 'Minimum similarity (%)', exact: true }).fill('98');
	await dialog.getByRole('button', { name: 'Find and label', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
	const saved = await savedProject(page, editor);
	const labels = saved.tracks.find(track => track.type === 'label');
	expect(labels.name).toBe('Repeated sounds');
	expect(labels.labels.map(label => [label.startFrame, label.endFrame, label.title])).toEqual([
		[24_000, 28_800, 'Original sound'], [72_000, 76_800, 'Repeated sound 1'],
	]);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect(editor.locator('[data-label-track]')).toHaveCount(0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
});

test('a macro uses the analyzer and closes the gap independently of Delete preferences in one undo', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/'); await importFiles(editor, [recording()]);
	await program(page, editor, [selectExample,
		'const result = await sound.analyze.repeatedSound({ similarityThreshold: .98 });',
		'sound.assertEqual(result.matches.length, 2);',
		'await sound.select.frames(result.matches[0].endFrame, result.matches[1].startFrame, { trackIds: [trackId] });',
		'await sound.edit.deleteAndCloseGap();',
		'const clips = await sound.project.clips(trackId);',
		'sound.assertEqual(clips.reduce((end, clip) => Math.max(end, clip.startFrame + clip.durationFrames), 0), 100800);',
		'await sound.select.frames(0, 0, { trackIds: [result.trackId] });',
		"await sound.command('RemoveTracks');",
	].join('\n'));
	const edited = await savedProject(page, editor);
	expect(edited.clips.reduce((sum, clip) => sum + clip.durationFrames, 0)).toBe(100_800);
	expect(edited.tracks.filter(track => track.type === 'label')).toHaveLength(0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await savedProject(page, editor);
	expect(restored.clips.map(clip => [clip.timelineStartFrame, clip.durationFrames])).toEqual([[0, 144_000]]);
	expect(restored.tracks.filter(track => track.type === 'label')).toHaveLength(0);
});
