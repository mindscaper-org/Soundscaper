/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const route of ['direct output bypass', 'ordinary Master processing', 'bus bypass', 'coexisting paths', 'automated coexisting paths', 'secondary output', 'Master secondary output']) test(`DAWproject roundtrip retains ${route}`, async ({ page }) => {
	test.setTimeout(90_000);
	const mixed = route.includes('coexisting'), automated = route.startsWith('automated');
	const bypass = route !== 'ordinary Master processing';
	const source = createAudioSource({ id: 'source', name: 'Voice.wav', sampleRate: 48_000, frameCount: 4800, channelCount: 2 });
	const base = createSoundscaperProject({ id: `daw-main-${route}`, title: 'Master bypass', sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, title: 'Voice', durationFrames: 4800, sourceDurationFrames: 4800 }),
			...(mixed ? [createAudioClip({ id: 'ordinary-clip', sourceId: source.id, durationFrames: 4800, sourceDurationFrames: 4800 })] : [])],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] }), ...(mixed ? [createAudioTrack({ id: 'ordinary', name: 'Ordinary', gain: .4, clipIds: ['ordinary-clip'] })] : []),
			...(route === 'Master secondary output' ? [createAudioTrack({ id: 'bypass', name: 'Empty bypass' })] : [])] });
	const output = base.mixer.outputs.find(candidate => candidate.role === 'main'); expect(output).toBeTruthy();
	const bus = { id: 'bus', name: 'Dry bus', color: '#456789', gain: 1, pan: 0, mute: false, solo: false,
		collapsed: false, effectsActive: true, effects: [], channelCount: 2 };
	const terminal = { kind: 'output', id: route === 'secondary output' ? 'cue-output' : output.id };
	const project = createSoundscaperProject({ ...base, master: { ...base.master, gain: .2 },
		...(automated ? { automationLanes: [{ id: 'master-gain', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'point', position: 0, value: .4 }], segments: [] }] } : {}),
		mixer: { ...base.mixer, groups: route === 'bus bypass' ? [bus] : [],
			outputs: [...base.mixer.outputs, ...(route.includes('secondary output') ? [{ id: 'cue-output', name: 'Cue output', role: 'cue', channelCount: 2 }] : [])], edges: [
				...base.mixer.edges.map(edge => route === 'Master secondary output' && edge.source.kind === 'master'
					? { ...edge, destination: { kind: 'output', id: 'cue-output' } }
					: edge.source.kind === 'track' && edge.source.id === 'bypass'
						? { ...edge, destination: { kind: 'output', id: output.id } }
						: bypass && route !== 'Master secondary output' && edge.source.kind === 'track' && edge.source.id === 'voice'
					? { ...edge, destination: route === 'bus bypass' ? { kind: 'mixer-node', id: bus.id } : terminal } : edge),
				...(route === 'bus bypass' ? [{ id: 'bus-output', kind: 'assignment', source: { kind: 'mixer-node', id: bus.id },
					destination: terminal, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] }] : []),
			],
		},
	});
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(4800).fill(.25), new Float32Array(4800).fill(-.125)]); await writer.commit();
		archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/', { defaultWorkspace: true });
	let choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Master bypass.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const before = await exportSamples(page, editor); expect(before).toHaveLength(4800);
	expect(before[2000]).toBeCloseTo(route.includes('secondary output') ? 0 : mixed ? automated ? .29 : .27 : bypass ? .25 : .05, 5);
	const downloading = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
	const download = await downloading; let bytes;
	try { bytes = await downloadBytes(download); } finally { await download.delete(); }
	choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Master bypass.dawproject', mimeType: 'application/zip', buffer: Buffer.from(bytes) });
	await expect(editor.locator('[data-status]')).toContainText('DAWproject imported.', { timeout: 30_000 }); await waitForProjectActivation(editor);
	const after = await exportSamples(page, editor); expect(after).toHaveLength(before.length);
	expect(after[2000]).toBeCloseTo(before[2000], 5);
});
