/* SPDX-License-Identifier: AGPL-3.0-only */
import { enabledVideoAudioTrackFixture, isoOpusTailFixture, nativeVideoAudioTailFixture, quickTimePcmTailFixture } from '../helpers/native-video-audio-tail-fixture.ts';
import { readWavePcm } from '../helpers/read-wave-pcm.ts';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, disableNativeSavePicker, importFiles, chooseExportProjectFileAction, chooseFileAction, downloadBytes, chooseNestedCommandAction, chooseCommandAction, chooseDropdown, openClipProperties, showClipTimingFields, clipField, closeClipProperties, openExportDialog, readDownloadBytes, waitForEditor, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { sourceMonitorFragmentedMedia } from './fixtures/video-timing-probe-media.js';

test('hybrid MP4 import retains AAC through the authored last sample', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const file = sourceMonitorFragmentedMedia()[2];
	await importFiles(editor, [file]);
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving));
	const project = JSON.parse(strFromU8(entries['project.json']));
	const video = project.sources.find(source => source.kind === 'video');
	const audio = project.sources.find(source => source.kind === 'audio');
	const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]);
	let energy = 0;
	for (let frame = 40_000; frame < 46_080; frame++) energy += pcm.readFloatLE(4 + frame * 4) ** 2;
	expect(Math.sqrt(energy / 6080)).toBeGreaterThan(.05);
	expect(audio.frameCount).toBe(46_400);
	expect(pcm.subarray(4 + 46_144 * 4)).toEqual(Buffer.alloc((46_400 - 46_144) * 4));
	expect(Buffer.from(entries[`media/${video.id}/original`])).toEqual(file.buffer);
});

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
	const savedOriginal = Buffer.from(entries[`media/${video.id}/original`]);
	expect(savedOriginal.byteLength).toBe(original.byteLength); expect(savedOriginal.equals(original)).toBe(true);
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

for (const pictureFrames of [2, 4]) test(`ISO Opus keeps the authored audio edit with ${pictureFrames} picture frames`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'The H.264 picture fixture follows its Chromium import qualification.');
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const original = isoOpusTailFixture(pictureFrames);
	await editor.locator('[data-project-bin-input]').setInputFiles({ name: 'Programme.mp4', mimeType: 'video/mp4', buffer: original });
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline:/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving));
	const project = JSON.parse(strFromU8(entries['project.json']));
	const picture = project.sources.find(source => source.kind === 'video');
	const audio = project.sources.find(source => source.kind === 'audio');
	const linked = project.clips.find(clip => clip.kind === 'audio');
	expect(picture.sourceFrameCount).toBe(pictureFrames);
	expect(Buffer.from(entries[`media/${picture.id}/original`])).toEqual(original);
	expect(linked).toMatchObject({ durationFrames: pictureFrames === 2 ? 3200 : 8000, avLinkId: expect.any(String) });
	const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]);
	expect(audio.frameCount).toBe(pictureFrames === 2 ? 5760 : 8000);
	let peak = 0;
	for (let frame = 4800; frame < 5600; frame++) peak = Math.max(peak, Math.abs(pcm.readFloatLE(4 + frame * 4)));
	expect(peak).toBeGreaterThan(.05);
	expect(pcm.subarray(4 + 5760 * 4)).toEqual(Buffer.alloc((audio.frameCount - 5760) * 4));
});

test('video import uses the only enabled AAC programme and preserves both original streams', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const original = enabledVideoAudioTrackFixture();
	await editor.locator('[data-project-bin-input]').setInputFiles({ name: 'Two programmes.mp4', mimeType: 'video/mp4', buffer: original });
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline:/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving));
	const project = JSON.parse(strFromU8(entries['project.json']));
	const picture = project.sources.find(source => source.kind === 'video');
	const audio = project.sources.find(source => source.kind === 'audio');
	const pcm = Buffer.from(entries[`audio/${audio.id}.f32c`]);
	const amplitudes = [430, 1170].map(frequency => {
		let sine = 0, cosine = 0;
		for (let frame = 4800; frame < 24_000; frame++) {
			const sample = pcm.readFloatLE(4 + frame * 4), phase = 2 * Math.PI * frequency * frame / 48_000;
			sine += sample * Math.sin(phase); cosine += sample * Math.cos(phase);
		}
		return Math.hypot(sine, cosine) / 9600;
	});
	expect(amplitudes[1]).toBeGreaterThan(.09);
	expect(amplitudes[0]).toBeLessThan(.002);
	expect(audio.frameCount).toBe(38_400);
	expect(pcm.subarray(4 + 34_560 * 4).every(byte => byte === 0)).toBe(true);
	expect(picture.characteristics.extractedAudioStreamIndex).toBe(2);
	expect(audio.opaqueExtensions.videoAudioProgramme).toEqual({ streamIndex: 2, pictureFrameCount: 38_400 });
	expect(Buffer.from(entries[`media/${picture.id}/original`])).toEqual(original);
});

test('a saved QuickTime PCM tail remains editable after reopening the Framescaper archive', async ({ page, browser, browserName }) => {
	test.skip(browserName !== 'chromium', 'The QuickTime picture fixture follows its Chromium import qualification.');
	test.setTimeout(75_000);
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const original = quickTimePcmTailFixture();
	await editor.locator('[data-project-bin-input]').setInputFiles({
		name: 'Camera.mov', mimeType: 'video/quicktime', buffer: original,
	});
	await editor.locator('[data-project-bin-item]').first().getByRole('button', { name: /Add to timeline:/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '2');
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

	const saving = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const archive = Buffer.from(await downloadBytes(await saving));
	const entries = unzipSync(archive);
	const project = JSON.parse(strFromU8(entries['project.json']));
	const picture = project.sources.find(source => source.kind === 'video');
	const audio = project.sources.find(source => source.kind === 'audio');
	const linked = project.clips.find(clip => clip.kind === 'audio');
	expect(picture.sourceFrameCount).toBe(20);
	expect(Buffer.from(entries[`media/${picture.id}/original`])).toEqual(original);
	expect(audio.frameCount).toBe(57_600);
	expect(linked.durationFrames).toBe(38_400);
	expect(linked.avLinkId).toBeTruthy();

	const fresh = await browser.newPage();
	try {
		await disableNativeSavePicker(fresh);
		const reopened = await bootEditor(fresh, '/framescaper/embed/en/');
		const choosing = fresh.waitForEvent('filechooser');
		await chooseFileAction(fresh, reopened, 'Open');
		await (await choosing).setFiles({ name: 'Camera.fscape', mimeType: 'application/zip', buffer: archive });
		await expect(reopened).toHaveAttribute('data-clip-count', '2');
		await waitForProjectActivation(reopened);
		const clip = reopened.getByRole('group', { name: /^Camera Audio clip,/u });
		await clip.press('Enter');
		await chooseNestedCommandAction(fresh, reopened, 'Edit', ['Audio clips', 'Unlink audio']);
		const properties = await openClipProperties(fresh, reopened, clip);
		await showClipTimingFields(properties);
		const duration = clipField(properties, 'durationFrame');
		await duration.fill('57600');
		await duration.press('Tab');
		await closeClipProperties(properties);
		const delivery = await openExportDialog(fresh, reopened, { label: 'Export video' });
		await chooseDropdown(fresh, delivery.locator('[data-export-field="format"]'), 'WAV');
		await delivery.getByRole('button', { name: 'Export', exact: true }).click();
		const { sampleRate, channels: [rendered] } = readWavePcm(
			await readDownloadBytes(fresh, delivery.locator('[data-export-download]')),
		);
		expect(sampleRate).toBe(48_000);
		expect(rendered).toHaveLength(57_600);
		const tail = rendered.slice(48_000, 55_000);
		expect(Math.sqrt(tail.reduce((sum, sample) => sum + sample ** 2, 0) / tail.length)).toBeGreaterThan(.15);
	} finally { await fresh.close(); }
});
