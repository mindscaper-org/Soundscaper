/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';
import { parseXmlDocument, walkXml } from '../../src/common/editor/dawproject-xml.ts';

for (const automated of [false, true]) for (const route of ['foreign-folder', 'foreign-chain', 'ordinary-submix']) test(`DAWproject export retains ${route} bus in the audible primary route${automated ? ' with automation' : ''}`, async ({ page }) => {
	test.setTimeout(90_000);
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: 'programme', title: 'Cross-sequence bus', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), createAudioTrack({ id: 'other', name: 'Other sequence recording' })],
		trackFolders: [...(route === 'foreign-chain' ? [{ id: 'parent', name: 'Parent bus', mute: true }] : []), { id: 'foreign', name: 'Foreign bus', mute: route === 'foreign-chain' }], primarySequenceId: 'first', sequences: [
			{ id: 'first', name: 'First', trackNodes: [{ kind: 'track', id: 'voice', parentFolderId: null }] },
			{ id: 'second', name: 'Second', trackNodes: [...(route === 'foreign-chain' ? [{ kind: 'folder', id: 'parent', parentFolderId: null }] : []), { kind: 'folder', id: 'foreign', parentFolderId: route === 'foreign-chain' ? 'parent' : null }, { kind: 'track', id: 'other', parentFolderId: 'foreign' }] },
		] });
	const ordinary = { ...base.mixer.groups[0], id: 'ordinary', name: 'Ordinary bus', gain: .4 };
	const project = createSoundscaperProject({ ...base, ...(automated ? { automationLanes: [{ id: 'gain-lane', address: { kind: 'strip', strip: { kind: 'mixer-node', id: route.startsWith('foreign') ? 'foreign' : ordinary.id }, parameterId: 'gain' }, timebase: 'absolute-samples', points: [{ id: 'gain-point', position: 0, value: .2 }], segments: [] }] } : {}), mixer: { ...base.mixer,
		groups: [...base.mixer.groups.map(group => ({ ...group, gain: .4 })), ...(route === 'ordinary-submix' ? [ordinary] : [])],
		edges: [...base.mixer.edges.map(edge => edge.source.kind === 'track' && edge.source.id === 'voice'
			? { ...edge, destination: { kind: 'mixer-node', id: route.startsWith('foreign') ? 'foreign' : ordinary.id } } : edge),
			...(route === 'ordinary-submix' ? [{ id: 'ordinary-master', kind: 'assignment', source: { kind: 'mixer-node', id: ordinary.id },
				destination: { kind: 'master' }, level: 1, position: 'post-fader', enabled: true, channelMap: [0, 1] }] : [])],
	} });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source); await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	let choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Cross-sequence bus.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800); expect(before[2000]).toBeCloseTo((automated ? .05 : .1) * (route === 'foreign-chain' ? .4 : 1), 5);
	const downloading = page.waitForEvent('download'); await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	const delivered = await readDawprojectArchive(new Blob([bytes]));
	try {
		const nodes = [...walkXml(parseXmlDocument(delivered.projectXml))]; const ids = new Set(nodes.map(node => node.attributes.id).filter(Boolean));
		expect.soft(nodes.flatMap(node => node.attributes.destination && !ids.has(node.attributes.destination) ? [node.attributes.destination] : [])).toEqual([]);
		expect(nodes.some(node => node.name === 'Track' && node.attributes.name === 'Other sequence recording')).toBe(false);
	} finally { await delivered.close(); }
	choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Cross-sequence bus.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length); expect(after[2000]).toBeCloseTo(before[2000], 5);
});
