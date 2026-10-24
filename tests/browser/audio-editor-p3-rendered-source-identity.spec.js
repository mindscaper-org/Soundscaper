/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation, openClipProperties, closeClipProperties, clipField, getMenuItem } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../../src/soundscaper/editor-project-playback.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const chunkFrames of [1024, 65536]) for (const authenticated of [false, true]) test(`Render pitch and speed retains a freezable source with authenticated input=${String(authenticated)} and input packet=${chunkFrames}`, async ({ page }) => {
	test.setTimeout(60_000);
	const projectId = `rendered-identity-${String(authenticated)}-${chunkFrames}`;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	let file;
	try {
		const source = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 24_000, sampleRate: 48_000, channelCount: 1, chunkFrames });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		const pcm = Float32Array.from({ length: source.frameCount }, (_, frame) => Math.sin(2 * Math.PI * 330 * frame / 48_000) * .25);
		for (let frame = 0; frame < source.frameCount; frame += chunkFrames) await writer.write([pcm.subarray(frame, frame + chunkFrames)]);
		await writer.commit();
		const contentSha256 = await playback.hashSourceContent(projectId, source);
		const project = createSoundscaperProject({ id: projectId, title: 'Rendered identity', sources: [authenticated ? { ...source, contentSha256 } : source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', sourceDurationFrames: source.frameCount, durationFrames: 12_000, speedRatio: 2, linkPitchAndTempo: true })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'], effects: [createEffect('lowpass', { id: 'filter', params: { frequency: 20_000, q: .707 } })] })] });
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Authenticated.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { playback.dispose(); await store.close(); }
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
	const clip = editor.locator('[data-clip-id="clip"]').first();
	await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
	await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
	const properties = await openClipProperties(page, editor, clip);
	await expect(clipField(properties, 'speedRatio')).toHaveValue('100'); await closeClipProperties(properties);
	const saving = page.waitForEvent('download', { timeout: 10_000 });
	await chooseExportProjectFileAction(page, editor);
	const entries = unzipSync(await downloadBytes(await saving));
	const saved = JSON.parse(strFromU8(entries['project.json']));
	const rendered = saved.sources.find(source => source.id === saved.clips.find(clip => clip.id === 'clip').sourceId);
	expect(rendered).toMatchObject({ frameCount: 12000, chunkFrames: 65536 });
	const pcm = entries[`audio/${rendered.id}.f32c`];
	expect(new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength).getUint32(0, true)).toBe(12000);
	await editor.locator('[data-track-id="voice"] [data-track-header]').click();
	const tracks = await openTracks(page, editor), freeze = getMenuItem(tracks, 'Freeze');
	await freeze.focus(); await page.keyboard.press('ArrowRight');
	await getMenuItem(freeze.getByRole('menu'), 'Freeze track').click();
	await expect.poll(async () => {
		const status = await openTracks(page, editor);
		const fresh = await getMenuItem(status, 'Freeze (fresh)').count();
		await page.keyboard.press('Escape'); return fresh;
	}, { timeout: 10_000 }).toBe(1);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

async function openTracks(page, editor) {
	await editor.getByRole('menubar', { name: 'Application menu', exact: true }).getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	const menu = page.getByRole('menu', { name: 'Tracks', exact: true }); await expect(menu).toBeVisible(); return menu;
}
