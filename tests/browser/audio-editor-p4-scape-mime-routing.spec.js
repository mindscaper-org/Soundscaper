/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, collectClientErrors, sourcePeakChannels, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const name of ['Session', 'Session.sscape', 'Session.backup']) test(`File Open imports a native project named ${name}`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const source = createAudioSource({ id: 'voice', name: 'Voice.wav', sampleRate: 48_000, channelCount: 1, frameCount: 4800 });
	const project = createSoundscaperProject({ id: `mime-project-${name}`, title: 'MIME project', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Voice', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'track', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25)]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	const chooser = await choosing;
	expect(await chooser.element().getAttribute('accept')).toContain('application/vnd.soundscaper.scape+zip');
	await chooser.setFiles({ name, mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect((await sourcePeakChannels(page, 'Voice.wav')).channels[0].maximum).toBeCloseTo(.25, 6);
	await page.reload(); await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	expect((await sourcePeakChannels(page, 'Voice.wav')).channels[0].maximum).toBeCloseTo(.25, 6);
	expect(errors).toEqual([]);
});
