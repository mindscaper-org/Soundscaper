/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseDawprojectDocument } from '../../src/common/editor/dawproject-import.ts';

for (const trackIds of [['master'], ['voice', 'voice:volume']]) test(`native track identities ${trackIds.join(',')} survive DAWproject delivery and reopening`, async ({ page }, testInfo) => {
	test.setTimeout(60_000);
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'recording', name: 'Recording.wav', sampleRate: 48_000, frameCount: 4_800, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'daw-export-identities', sampleRate: 48_000, sources: [source],
		tracks: trackIds.map((id, index) => createAudioTrack({ id, name: `Voice ${index + 1}`, clipIds: [`clip-${index}`] })),
		clips: trackIds.map((_, index) => createAudioClip({ id: `clip-${index}`, sourceId: source.id, durationFrames: 4_800, sourceDurationFrames: 4_800 })),
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `native-daw-identities-${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}` });
	let native;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4_800).fill(0.125)]); await writer.commit();
		native = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	let choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Native identities.sscape', mimeType: 'application/zip', buffer: Buffer.from(await native.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 30_000 }); await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', String(trackIds.length));
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const exported = await downloadBytes(await downloading);
	const archive = await readDawprojectArchive(new Blob([exported]));
	try {
		const document = parseDawprojectDocument(archive.projectXml);
		expect(document.tracks.filter(track => track.channel?.role === 'regular').map(track => track.name))
			.toEqual(trackIds.map((_, index) => `Voice ${index + 1}`));
	} finally { await archive.close(); }
	choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Roundtrip.dawproject', mimeType: 'application/zip', buffer: Buffer.from(exported) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 });
	await waitForProjectActivation(editor);
	await expect(editor).toHaveAttribute('data-clip-count', String(trackIds.length));
});
