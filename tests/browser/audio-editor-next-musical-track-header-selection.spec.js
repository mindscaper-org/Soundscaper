/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor } from './audio-editor-test-helpers.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject, SCAPE_MIME_TYPE } from '../../src/common/editor/scape-project.js';

test('a musical clip track-header double click selects its complete authored range', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
		configurable: true, value: { setConsumer(consumer) { globalThis.__nextMusicTrackLaunch = consumer; } },
	}));
	const editor = await bootEditor(page, '/en/');
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(48_000)]); await writer.commit();
	const project = createSoundscaperProject({ id: 'musical-header', sources: [source], clips: [createAudioClip({ id: 'music', sourceId: source.id,
		anchor: 'musical', musicalStartBeat: { num: 4, den: 1 }, musicalExtent: 'beat', musicalDurationBeats: { num: 2, den: 1 }, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['music'] })] });
	const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
	await page.evaluate(({ bytes, mimeType }) => {
		const binary = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
		globalThis.__nextMusicTrackLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(new File([binary], 'Music.sscape', { type: mimeType })) }] });
	}, { bytes: Buffer.from(await archive.blob.arrayBuffer()).toString('base64'), mimeType: SCAPE_MIME_TYPE });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await editor.locator('[data-track-row][data-track-id="voice"] .track-control-panel').dblclick({ position: { x: 6, y: 100 } });
	await expect(editor.getByRole('group', { name: 'Selection duration', exact: true }).locator('.timecode__display')).toHaveText('00h00m01.000s');
	await expect(editor.getByRole('group', { name: 'Selection start', exact: true }).locator('.timecode__display')).toHaveText('00h00m02.000s');
});
