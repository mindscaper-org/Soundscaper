/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, waitForProjectActivation, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function projectBytes() {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 });
	const clips = ['a:b', 'c', 'a', 'b:c'].map((id, index) => createAudioClip({ id, title: ['First outgoing', 'First incoming', 'Second outgoing', 'Second incoming'][index], sourceId: source.id,
		timelineStartFrame: [0, 48_000, 192_000, 240_000][index], durationFrames: 96_000, sourceDurationFrames: 96_000 }));
	const project = createSoundscaperProject({ id: 'crossfade-pair-keys', title: 'Crossfades', sources: [source], clips,
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: clips.map(clip => clip.id) })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(65_536).fill(.25)]); await writer.write([new Float32Array(30_464).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store);
		return Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	} finally { await store.close(); }
}

async function launch(page, bytes) {
	await page.evaluate(bytes => {
		const body = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
		globalThis.__applicationMenuLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(
			new File([body], 'Programme.sscape', { type: 'application/x-scape-project' }),
		) }] });
	}, bytes);
}

test('splitting an ordinary outgoing clip keeps exactly its two real crossfades', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__applicationMenuLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/embed/en/');
	await launch(page, await projectBytes());
	await expect(editor).toHaveAttribute('data-project-id', 'crossfade-pair-keys');
	await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'View', ['Zoom', 'Fit project']);
	const handles = editor.locator('[data-track-row]').getByRole('slider', { name: /^Automatic crossfade between /u });
	await expect(handles).toHaveCount(2);
	const clip = clipByName(editor, 'First outgoing');
	await clip.focus(); await clip.press('Enter');
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	await playhead.press('Home');
	for (let i = 0; i < 5; i += 1) await playhead.press('ArrowRight');
	await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Split']);
	await expect(editor).toHaveAttribute('data-clip-count', '5');
	await expect(handles).toHaveCount(2);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '4');
	await expect(handles).toHaveCount(2);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '5');
	await expect(handles).toHaveCount(2);
});
