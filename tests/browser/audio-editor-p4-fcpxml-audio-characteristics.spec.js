/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const [sampleRate, channels, audioRate, audioLayout] of [[96_000, 1, '96k', 'mono'], [48_000, 2, '48k', 'stereo']]) {
	test(`FCPXML menu download retains native ${sampleRate}Hz/${channels} channel programme`, async ({ page }) => {
		const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Take.wav', frameCount: sampleRate, channelCount: 2, sampleRate });
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Take', sourceStartFrame: 0,
			sourceDurationFrames: sampleRate, timelineStartFrame: sampleRate, durationFrames: sampleRate });
		const project = createSoundscaperProject({ id: `fcpxml-audio-${sampleRate}-${channels}`, title: 'Programme audio', sampleRate,
			masterChannels: channels, sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			for (let offset = 0; offset < sampleRate; offset += 65_536) {
				const frames = Math.min(65_536, sampleRate - offset);
				await writer.write([new Float32Array(frames).fill(.25), new Float32Array(frames).fill(-.125)]);
			}
			await writer.commit(); archive = (await exportScapeProject(project, store)).blob;
		} finally { await store.close(); }
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Programme.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		const downloading = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export FCPXML']);
		const download = await downloading; let text;
		try { text = Buffer.from(await downloadBytes(download)).toString('utf8'); } finally { await download.delete(); }
		const sequence = text.match(/<sequence\b[^>]*>/u)?.[0]; expect(sequence).toBeTruthy();
		expect(sequence.match(/\baudioRate="([^"]+)"/u)?.[1] ?? '48k').toBe(audioRate);
		expect(sequence.match(/\baudioLayout="([^"]+)"/u)?.[1] ?? 'stereo').toBe(audioLayout);
		expect(text).toMatch(/<asset-clip[^>]*offset="1s"[^>]*start="0s"[^>]*duration="1s"/u);
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	});
}
