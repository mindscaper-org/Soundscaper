/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { applyMixerSurfaceCommandV21 } from '../../src/common/editor/mixer-graph-surface-v21.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { strFromU8, unzipSync } from 'fflate';

for (const sendId of ['__proto__', 'reverb']) test(`native send ${sendId} shows its real level and edits from the compact Mixer`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'recording', sampleRate: 48_000, frameCount: 48_000, channelCount: 2 });
	let project = createSoundscaperProject({ id: `send-${sendId}`, sampleRate: 48_000, sources: [source],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })] });
	project = createSoundscaperProject({ ...project, mixer: applyMixerSurfaceCommandV21(project, {
		type: 'mixer/bus-add', busType: 'send', bus: { id: sendId, name: 'Reverb' },
	}) });
	project = createSoundscaperProject({ ...project, mixer: applyMixerSurfaceCommandV21(project, {
		type: 'mixer/route-update', trackId: 'voice', changes: { sends: { [sendId]: 0.5 } },
	}) });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `native-send-${sendId}` });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(source.frameCount).fill(0.1), new Float32Array(source.frameCount).fill(0.1)]); await writer.commit();
		archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Send level.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor);
	expect(before[4_800]).toBeCloseTo(0.15, 4);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const send = editor.locator('[data-mixer-panel]').getByRole('slider', { name: 'Send level: Voice → Reverb', exact: true });
	await expect.poll(async () => Number(await send.getAttribute('aria-valuenow'))).toBeCloseTo(20 * Math.log10(0.5), 2);
	await send.press('End');
	for (let step = 0; step < 12; step++) await send.press('ArrowDown');
	await expect(send).toHaveAttribute('aria-valuenow', '0');
	const downloaded = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloaded))['project.json']));
	expect(saved.mixer.edges.filter(edge => edge.kind === 'send')).toHaveLength(1);
	expect(saved.mixer.edges.find(edge => edge.kind === 'send').level).toBe(1);
	const after = await exportSamples(page, editor);
	expect(after[4_800]).toBeCloseTo(0.2, 4);
});
