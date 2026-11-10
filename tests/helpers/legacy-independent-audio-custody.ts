/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { importSoundscaperAudacityProject } from '../../src/soundscaper/editor-audacity-project-import.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { decodeAuBlockFile } from '../../src/common/editor/aup-legacy.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import { createMemoryEngine, type createAudioEditorController } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { controllerSession } from './soundscaper-controller-session.ts';
import { legacyAupFiles } from './more200-legacy-aup-file.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { readPcm } from './project-store-pcm-fixture.ts';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';

export type LegacyIndependentFolder = false | true | 'case-sibling' | 'uppercase-marker';

/** Actual legacy blocks and independent audio, reopened sample for sample in a fresh repository. */
export async function legacyIndependentAudioCustody(context: TestContext, options: {
	format: 'au' | 'wav'; folder: LegacyIndependentFolder; standaloneFirst: boolean;
}) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const codec = { ...createMemoryFfmpeg(), decode: async (file: File) => ({
		channels: [decodeAuBlockFile(new Uint8Array(await file.arrayBuffer()))], sampleRate: 48_000,
	}) };
	const { controller, store } = await controllerSession(context, {
		adaptAudacityProject: importSoundscaperAudacityProject,
		engine: { ...createMemoryEngine(), decodeAudioData: async () => {
			throw new DOMException('Native decoders are unavailable in Node', 'NotSupportedError');
		} } as unknown as Options['engine'], ffmpeg: codec as unknown as Options['ffmpeg'],
	});
	const { projectFile, dataFile } = legacyAupFiles('utf-8');
	const independentPcm = options.format === 'wav'
		? Float32Array.from({ length: 9600 }, (_, frame) => (frame % 31 - 15) / 32) : new Float32Array(4800).fill(-.5);
	const independentAu = new Uint8Array(await dataFile.arrayBuffer());
	const view = new DataView(independentAu.buffer);
	if (options.format === 'au') for (let frame = 0; frame < independentPcm.length; frame++) view.setFloat32(24 + frame * 4, independentPcm[frame]!);
	const independent = new File([options.format === 'wav'
		? Uint8Array.from(encodeWav([independentPcm], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false })) : independentAu],
	'Independent.au', { type: options.format === 'wav' ? 'audio/wav' : 'audio/basic' });
	const orphan = new File([independentAu], 'orphan.au');
	if (options.folder) {
		const directory = options.folder === 'uppercase-marker' ? 'Selected/Session_DATA' : 'Selected/Session_data';
		Object.defineProperty(dataFile, 'webkitRelativePath', { value: `${directory}/e00/d00/e0000.au` });
		Object.defineProperty(orphan, 'webkitRelativePath', { value: `${directory}/orphan.au` });
		Object.defineProperty(independent, 'webkitRelativePath', { value: `${options.folder === 'case-sibling'
			? 'Selected/SESSION_DATA' : options.folder === true ? 'Selected/Other_data' : 'Selected'}/Independent.au` });
	}
	// The original browser scenario imports audio before opening the mixed batch.
	if (options.standaloneFirst) {
		await controller.actions.project.importFiles([independent]);
		const initial: unknown = controller.project; assert.ok(validateSoundscaperProject(initial));
		assert.equal(initial.sources.length, 1); const source = initial.sources[0]; assert.ok(source);
		assertPcmChannelsEqual(await readPcm(store, source.storageKey), [[...independentPcm]], 'standalone import');
	}
	const files = options.standaloneFirst ? [independent, projectFile, dataFile] : [projectFile, dataFile, independent];
	await controller.actions.project.importFiles(options.folder ? [...files, orphan] : files);
	await controller.actions.project.flush();
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	assert.equal(project.clips.length, 2); assert.equal(project.sources.length, 2);
	assert.ok(project.tracks.some(track => track.name === 'Voix 日本語 🎙'));
	const clip = project.clips.find(item => item.title === independent.name || item.title === 'Independent'); assert.ok(clip);
	assert.equal(clip.durationFrames, independentPcm.length); assert.equal(clip.sourceStartFrame, 0);
	const source = project.sources.find(item => item.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(source.frameCount, independentPcm.length); assert.equal(source.sampleRate, 48_000); assert.equal(source.channelCount, 1);
	const legacy = project.sources.find(item => item.id !== source.id); assert.ok(legacy?.kind === 'audio');
	const expected = new Map([[source.id, [...independentPcm]], [legacy.id, Array.from({ length: 4800 }, (_, frame) => frame % 2 ? -.25 : .25)]]);
	for (const item of project.sources) {
		const samples = expected.get(item.id); assert.ok(samples);
		assertPcmChannelsEqual(await readPcm(store, item.storageKey), [samples], `independent ${item.name}`);
	}
	assert.deepEqual(await store.loadProject(project.id), project);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, store); assert.ok(archive.blob);
	const reopened = await runtime.importScapeProject(archive.blob, recipient); assert.equal(reopened.readOnly, false);
	assert.ok(validateSoundscaperProject(reopened.project)); assert.deepEqual(reopened.project, project);
	for (const item of reopened.project.sources) {
		const samples = expected.get(item.id); assert.ok(samples);
		assertPcmChannelsEqual(await readPcm(recipient, item.storageKey), [samples], `portable ${item.name}`);
	}
}
