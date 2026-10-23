/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function projectBytes(id, incoming = false) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'voice-take', title: 'Voice recording', sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const voice = createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] });
	const project = createSoundscaperProject({ id, title: id, sources: [source], clips: [clip],
		tracks: incoming ? [createAudioTrack({ id: 'music', name: 'Music', clipIds: [] }), voice] : [voice] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
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

test('an outgoing application menu cannot duplicate audio in an incoming project', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__applicationMenuLaunch = consumer; } },
	}));
	const outgoing = await projectBytes('application-menu-outgoing');
	const incoming = await projectBytes('application-menu-incoming', true);
	const editor = await bootEditor(page, '/embed/en/');
	await launch(page, outgoing);
	await expect(editor).toHaveAttribute('data-project-id', 'application-menu-outgoing');
	await waitForProjectActivation(editor);
	await clipByName(editor, 'Voice recording').click();
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	const popup = page.locator('.kw-audio-editor__application-menu[role="menu"]');
	await expect(popup.getByRole('menuitem', { name: 'Duplicate track', exact: true })).toBeEnabled();
	await launch(page, incoming);
	await expect(editor).toHaveAttribute('data-project-id', 'application-menu-incoming');
	await waitForProjectActivation(editor);
	if (await popup.count()) await popup.getByRole('menuitem', { name: 'Duplicate track', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '2');
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	await expect(popup).toHaveCount(0);
	await clipByName(editor, 'Voice recording').click();
	await editor.getByRole('menubar').getByRole('menuitem', { name: 'Tracks', exact: true }).click();
	await popup.getByRole('menuitem', { name: 'Duplicate track', exact: true }).click();
	await expect(editor).toHaveAttribute('data-track-count', '3');
	await expect(editor).toHaveAttribute('data-clip-count', '2');
});
