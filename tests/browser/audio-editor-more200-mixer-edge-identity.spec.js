/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { strFromU8, unzipSync } from 'fflate';

test('File Open colon-bearing track and group identities can route independently from Mixer', async ({ page }) => {
	await disableNativeSavePicker(page);
	const sources = ['first', 'second'].map(id => createAudioSource({ id, sampleRate: 48_000, frameCount: 4_800, channelCount: 2 }));
	let project = createSoundscaperProject({ id: 'mixer-edge-identities', sampleRate: 48_000, sources,
		tracks: [createAudioTrack({ id: 'a:mixer-node:b', name: 'First voice', clipIds: ['one'] }), createAudioTrack({ id: 'a', name: 'Second voice', clipIds: ['two'] })],
		clips: sources.map((source, index) => createAudioClip({ id: index ? 'two' : 'one', sourceId: source.id, durationFrames: 4_800, sourceDurationFrames: 4_800 })) });
	for (const [id, name, gain] of [['c', 'First group', 0.5], ['b:mixer-node:c', 'Second group', 0.25]]) project = apply(project, {
		type: 'mixer/bus-add', busType: 'group', bus: { id, name, gain },
	});
	project = apply(project, { type: 'mixer/route-update', trackId: 'a:mixer-node:b', changes: { groupId: 'c' } });
	project = createSoundscaperProject({ ...project, mixer: { ...project.mixer, edges: project.mixer.edges.map(edge =>
		edge.source.kind === 'track' && edge.source.id === 'a:mixer-node:b' ? { ...edge, id: 'assignment:track:a:mixer-node:b:mixer-node:c' } : edge) } });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: 'native-edge-identities' });
	let archive;
	try {
		for (const [index, source] of sources.entries()) {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([new Float32Array(4_800).fill(index ? 0.05 : 0.1), new Float32Array(4_800).fill(index ? 0.05 : 0.1)]); await writer.commit();
		}
		archive = (await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Independent routes.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	await chooseNestedCommandAction(page, editor, 'Window', ['Mixer']);
	const first = editor.getByRole('combobox', { name: 'Output: First voice', exact: true });
	const second = editor.getByRole('combobox', { name: 'Output: Second voice', exact: true });
	await expect(first).toHaveValue('c'); await expect(second).toHaveValue('');
	await second.selectOption('b:mixer-node:c'); await expect(second).toHaveValue('b:mixer-node:c');
	await expect(first).toHaveValue('c');
	expect((await exportSamples(page, editor))[480]).toBeCloseTo(0.0625, 5);
	const downloaded = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const saved = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloaded))['project.json']));
	const edges = saved.mixer.edges.filter(edge => edge.source.kind === 'track');
	expect(new Set(edges.map(edge => edge.id)).size).toBe(2);
	expect(edges.map(edge => [edge.source.id, edge.destination.id]).sort()).toEqual([['a', 'b:mixer-node:c'], ['a:mixer-node:b', 'c']]);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(second).toHaveValue('');
	expect((await exportSamples(page, editor))[480]).toBeCloseTo(0.1, 5);
	await editor.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(second).toHaveValue('b:mixer-node:c');
	expect((await exportSamples(page, editor))[480]).toBeCloseTo(0.0625, 5);
});
