/* SPDX-License-Identifier: AGPL-3.0-only */
import { nativeVideoAudioTailFixture } from '../helpers/native-video-audio-tail-fixture.ts';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, disableNativeSavePicker, importFiles, chooseExportProjectFileAction, downloadBytes, chooseNestedCommandAction, chooseCommandAction, openClipProperties, showClipTimingFields, clipField, closeClipProperties, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

for (const picture of [1, 2]) test(`video import retains its longer audio programme: ${picture}s picture, 2s audio`, async ({ page }, testInfo) => {
	test.setTimeout(60_000); const errors = collectClientErrors(page);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	const original = nativeVideoAudioTailFixture(picture);
	await importFiles(editor, [{ name: 'Programme.mp4', mimeType: 'video/mp4', buffer: original }]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving)), project = JSON.parse(strFromU8(entries['project.json']));
	const videos = project.sources.filter(source => source.kind === 'video'), audios = project.sources.filter(source => source.kind === 'audio');
	expect(videos).toHaveLength(1); expect(audios).toHaveLength(1);
	const audio = audios[0], video = videos[0];
	await testInfo.attach('imported-extents.json', { body: JSON.stringify({ picture, video, audio, clips: project.clips }), contentType: 'application/json' });
	expect(video).toMatchObject({ sourceFrameCount: 25 * picture, width: 64, height: 32 });
	expect(Buffer.from(entries[`media/${video.id}/original`])).toEqual(original);
	expect(audio.frameCount).toBe(96_000);
	const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]); let energy = 0;
	for (let frame = 72_000; frame < 84_000; frame++) energy += pcm.readFloatLE(4 + frame * 4) ** 2;
	expect(Math.sqrt(energy / 12_000)).toBeGreaterThan(.05);
	const initial = await exportSamples(page, editor); expect(initial.length).toBe(48_000 * picture);
	if (picture === 1) {
		const clip = editor.getByRole('group', { name: /^Programme Audio clip,/u }); await clip.press('Enter');
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Unlink audio']);
		const properties = await openClipProperties(page, editor, clip); await showClipTimingFields(properties);
		await clipField(properties, 'durationFrame').fill('96000'); await clipField(properties, 'durationFrame').press('Tab');
		await closeClipProperties(properties); await expect(clip).toHaveAccessibleName(/2 seconds long$/u);
	}
	const output = await exportSamples(page, editor); expect(output.length).toBe(96_000);
	energy = 0; for (let frame = 72_000; frame < 84_000; frame++) energy += output[frame] ** 2;
	expect(Math.sqrt(energy / 12_000)).toBeGreaterThan(.05);
	if (picture === 1) {
		await chooseCommandAction(page, editor, 'Edit', 'Undo'); expect((await exportSamples(page, editor)).length).toBe(48_000);
		await chooseCommandAction(page, editor, 'Edit', 'Redo'); expect((await exportSamples(page, editor)).length).toBe(96_000);
	}
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved'); await page.reload();
	await waitForEditor(page); await waitForProjectActivation(editor); await expect(editor).toHaveAttribute('data-clip-count', '2');
	expect((await exportSamples(page, editor)).length).toBe(96_000);
	expect(errors).toEqual([]);
});
