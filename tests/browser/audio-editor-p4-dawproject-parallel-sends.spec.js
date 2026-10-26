/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const parallel of [true, false]) test(`DAWproject roundtrip retains ${parallel ? 'parallel pre/post sends' : 'one send'} programme routing`, async ({ page }) => {
	test.setTimeout(90_000);
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: `daw-parallel-${parallel}`, title: 'Send routing', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain: .5, clipIds: ['clip'] })] });
	const send = { id: 'wet', name: 'Wet', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const project = createSoundscaperProject({ ...base, mixer: { ...base.mixer, sends: [send], edges: [
		...base.mixer.edges,
		...(parallel ? [{ id: 'voice-wet-pre', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: send.id },
			position: 'pre-fader', level: .2, enabled: true, channelMap: [0, 1] }] : []),
		{ id: 'voice-wet', kind: 'send', source: { kind: 'track', id: 'voice' }, destination: { kind: 'mixer-node', id: send.id },
			position: 'post-fader', level: .3, enabled: true, channelMap: [0, 1] },
		{ id: 'wet-master', kind: 'assignment', source: { kind: 'mixer-node', id: send.id }, destination: { kind: 'master' },
			position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] },
	] } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	let choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Send routing.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800);
	expect(before[2000]).toBeCloseTo(parallel ? .2125 : .1625, 5);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Send routing.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	expect(after[2000]).toBeCloseTo(before[2000], 5);
});
