/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { importWorkspaceRoutedFiles } from '../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import { legacyAupFiles } from './helpers/more200-legacy-aup-file.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
for (const format of ['legacy48000', 'legacy44100', 'media'] as const) test(`a ${format} file batch owns its destination track and elapsed drop time`, async context => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		adaptAudacityProject: importSoundscaperAudacityProject, projectRuntime: runtime, sessionController: runtime.createSessionController(),
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const outgoing: unknown = controller.project; assert.ok(validateSoundscaperProject(outgoing));
	const target = outgoing.tracks.find(track => track.type === 'audio'); assert.ok(target);
	const audio = new File([Uint8Array.from(encodeWav([new Float32Array(4800).fill(.5)], { sampleRate: 48_000, bitDepth: 16 }))], 'Independent.wav', { type: 'audio/wav' });
	let files: File[];
	if (format !== 'media') {
		const { projectFile, dataFile } = legacyAupFiles('utf-8');
		const incomingRate = format === 'legacy44100' ? 44_100 : 48_000;
		const xml = (await projectFile.text()).replaceAll('rate="48000"', `rate="${String(incomingRate)}"`);
		const block = await dataFile.arrayBuffer(); new DataView(block).setUint32(16, incomingRate);
		files = [new File([xml], projectFile.name, { type: projectFile.type }), new File([block], dataFile.name), audio];
	} else files = [audio];
	await importWorkspaceRoutedFiles({ controller, files, importOptions: { destination: 'timeline', trackId: target.id, timelineStartFrame: outgoing.sampleRate },
		openProjectFile: () => { throw new Error('Legacy projects with their blocks use the media importer.'); }, projectBinVisible: false,
		requestCueImport: () => { throw new Error('This batch has no CUE sheet.'); } });
	const after: unknown = controller.project; assert.ok(validateSoundscaperProject(after));
	const imported = after.clips.find(clip => clip.title === 'Independent.wav' || clip.title === 'Independent'); assert.ok(imported, 'the accompanying recording is imported');
	assert.equal(imported.timelineStartFrame, after.sampleRate, 'one second retains its elapsed placement across sample clocks');
	const owner = after.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(imported.id)); assert.ok(owner);
	if (format === 'media') assert.equal(owner.id, target.id, 'a media-only batch keeps its explicitly chosen lane');
	else { assert.notEqual(after.id, outgoing.id); assert.notEqual(owner.id, target.id, 'an outgoing lane cannot own incoming media'); }
	const source = after.sources.find(item => item.id === imported.sourceId); assert.ok(source);
	const chunk = await store.readSourceChunk(source.storageKey, 0); assert.ok(chunk); assert.ok(Math.abs((chunk.channels[0]?.[0] ?? 0) - .5) < .0001);
});
