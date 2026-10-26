/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForProjectActivation, chooseNestedCommandAction, getMenuItem } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { createSoundscaperPlaybackProjectService } from '../../src/soundscaper/editor-project-playback.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const authenticated of [false, true]) test(`Sample pencil retains a freezable source with authenticated input=${String(authenticated)}`, async ({ page }) => {
	test.setTimeout(60_000);
	const projectId = `rendered-identity-${String(authenticated)}`;
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	let file;
	try {
		const source = createAudioSource({ id: 'original', name: 'Original.wav', frameCount: 96, sampleRate: 48_000, channelCount: 1 });
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: source.frameCount }, (_, frame) => Math.sin(2 * Math.PI * 1000 * frame / 48_000) * .25)]); await writer.commit();
		const contentSha256 = await playback.hashSourceContent(projectId, source);
		const project = createSoundscaperProject({ id: projectId, title: 'Rendered identity', sources: [authenticated ? { ...source, contentSha256 } : source],
			clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', sourceDurationFrames: source.frameCount, durationFrames: 96, speedRatio: 1, linkPitchAndTempo: true })],
			tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'], effects: [createEffect('lowpass', { id: 'filter', params: { frequency: 20_000, q: .707 } })] })] });
		const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Authenticated.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { playback.dispose(); await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', projectId); await waitForProjectActivation(editor);
	const clip = editor.locator('[data-clip-id="clip"]').first();
	await clip.locator('.clip-header').click();
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Zoom to selection']);
	await expect(editor.getByRole('toolbar', { name: 'Sample tools', exact: true })).toBeVisible();
	const box = await clip.locator('.clip-display').boundingBox();
	const canvas = await clip.locator('canvas.clip-body__waveform').boundingBox();
	await page.mouse.click(box.x + 32.1 / 96 * box.width, canvas.y + canvas.height * .25);
	await expect(editor.locator('[data-status]')).toHaveText('Edited samples.', { timeout: 20_000 });
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
