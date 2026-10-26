/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createAudioSource, createAudioClip, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

/** @param {string} id */
async function projectFile(id) {
	const source = createAudioSource({ id: 'voice-source', name: 'Voice', frameCount: 12_000, channelCount: 1, sampleRate: 48_000 });
	const clip = createAudioClip({ id: 'voice', sourceId: source.id, title: 'Voice', sourceDurationFrames: 12_000, durationFrames: 12_000,
		warpMap: { feature: 'audio-warp', points: [0, 1000, 12_000].map(value => ({ outer: { num: value, den: 1 }, source: { num: value, den: 1 }, mode: 'forward' })) } });
	const project = createSoundscaperProject({ id, title: id, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice-track', name: 'Voice', clipIds: [clip.id] })],
		selection: { startFrame: 0, endFrame: 12_000, clipIds: [clip.id], trackIds: ['voice-track'] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `next-warp-${id}` });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, { name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate, channelCount: source.channelCount, chunkFrames: source.chunkFrames });
		await writer.write([new Float32Array(12_000)]); await writer.commit();
		const exported = await exportScapeProject(project, store); expect(exported.blob).toBeInstanceOf(Blob);
		return Buffer.from(await exported.blob.arrayBuffer()).toString('base64');
	} finally { await store.close(); }
}
/** @param {import('@playwright/test').Page} page @param {string} content */
async function launch(page, content) {
	await page.evaluate(({ content, mimeType }) => {
		const bytes = Uint8Array.from(atob(content), character => character.charCodeAt(0));
		globalThis.__nextWarpLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([bytes], 'voice.sscape', { type: mimeType })) }] });
	}, { content, mimeType: SCAPE_MIME_TYPE });
}

test('OS file activation retires an outgoing warp marker row draft', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__nextWarpLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	await launch(page, await projectFile('warp-outgoing'));
	await expect(editor).toHaveAttribute('data-project-id', 'warp-outgoing'); await waitForProjectActivation(editor);
	await clipByName(editor, 'Voice').press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	const dialog = page.getByRole('dialog', { name: 'Audio warp and transients', exact: true });
	const outer = dialog.getByLabel('Marker 1 outer position', { exact: true });
	await expect(outer).toHaveValue('1000/1'); await outer.fill('2000');
	await launch(page, await projectFile('warp-incoming'));
	await expect(editor).toHaveAttribute('data-project-id', 'warp-incoming'); await waitForProjectActivation(editor);
	await expect(outer).toHaveValue('1000/1');
	await outer.fill('3000'); await dialog.getByRole('button', { name: 'Move marker 1', exact: true }).click();
	await expect(outer).toHaveValue('3000/1');
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await chooseNestedCommandAction(page, editor, 'Edit', ['Undo']);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Pitch and tempo', 'Audio warp and transients']);
	await expect(outer).toHaveValue('1000/1');
});
