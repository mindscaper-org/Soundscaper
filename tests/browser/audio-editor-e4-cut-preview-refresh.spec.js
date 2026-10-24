/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('adding a track retires a stale cut audition without replaying its gap', async ({ page }) => {
	await page.addInitScript(() => {
		globalThis.__selectionRefreshStarts = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext && this.buffer?.length > 0) {
				globalThis.__selectionRefreshStarts.push({ frames: this.buffer.length, offset: args[1] ?? 0, duration: args[2] ?? this.buffer.duration });
			}
			return Reflect.apply(start, this, args);
		};
	});
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 480_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'cut-preview-refresh', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		selection: { startFrame: 96_000, endFrame: 288_000, trackIds: ['voice'], clipIds: [] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let blob;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) }, (_, frame) => .1 * (Math.sin(2 * Math.PI * 512 * (offset + frame) / 48_000) + Math.sin(2 * Math.PI * 4096 * (offset + frame) / 48_000))),
		]);
		await writer.commit(); blob = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const errors = collectClientErrors(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Selection.sscape', mimeType: 'application/zip', buffer: Buffer.from(await blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await editor.getByRole('button', { name: 'Play options', exact: true }).click();
	await page.getByRole('menu', { name: 'Play options', exact: true }).getByRole('menuitem', { name: 'Cut preview', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__selectionRefreshStarts.length)).toBe(1);
	expect(await page.evaluate(() => globalThis.__selectionRefreshStarts[0].frames)).toBe(144_000);
	const before = await page.evaluate(() => globalThis.__selectionRefreshStarts.length);
	await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
	await expect(editor.locator('[data-track-row]')).toHaveCount(2);
	await expect(editor.locator('[data-transport="play"]').getByRole('button', { name: 'Play', exact: true })).toBeVisible();
	expect(await page.evaluate(() => globalThis.__selectionRefreshStarts.length)).toBe(before);
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__selectionRefreshStarts.at(-1).frames)).toBe(480_000);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});
