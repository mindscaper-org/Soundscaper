/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createAudioEditorFileService } from '../../src/common/editor/file-service.js';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { readMidiClip } from '../../src/common/editor/midi-model.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { assertPcmChannelsEqual } from './assert-pcm-samples.ts';
import { readPcm } from './project-store-pcm-fixture.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type FileRequest = Readonly<{ suggestedName?: string; bytes?: Uint8Array | ArrayBuffer; text?: string }>;

/** Real MIDI parsing, synthesis, controller publication and portable storage. */
export async function midiImportArchiveCustody(context: TestContext) {
	const saved: FileRequest[] = [];
	const sender = await open();
	return { ...sender, saved, async reopen() {
		const project = sender.controller.project;
		assert.ok(validateSoundscaperProject(project));
		await sender.controller.actions.project.flush();
		const originalPcm = new Map<string, number[][]>();
		for (const source of project.sources) {
			assert.ok(source.kind === 'audio');
			originalPcm.set(source.id, await readPcm(sender.store, source.storageKey));
		}
		const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, sender.store);
		assert.ok(archive.blob);
		await sender.controller.dispose();
		const recipient = await open();
		await recipient.controller.actions.project.openScapeFile(new File([archive.blob], 'Notes.sscape'), () => 'copy');
		assert.equal(recipient.controller.getSnapshot().readOnly, false);
		const restored = recipient.controller.project;
		assert.ok(validateSoundscaperProject(restored));
		assert.equal(restored.sources.length, project.sources.length);
		for (const source of restored.sources) {
			const expected = originalPcm.get(source.id); assert.ok(expected);
			const samples = await readPcm(recipient.store, source.storageKey);
			assert.equal(samples[0]?.length, source.frameCount);
			assertPcmChannelsEqual(samples, expected, 'synthesized MIDI archive');
			const authored = restored.clips.some(clip => clip.sourceId === source.id && (readMidiClip(clip)?.notes.length ?? 0) > 0);
			if (authored) assert.ok(samples.some(channel => channel.some(value => Math.abs(value) > .01)), 'real synthesis must publish audible PCM');
			else assert.ok(samples.every(channel => channel.every(value => value === 0)), 'empty MIDI lanes retain silent PCM');
		}
		return { ...recipient, project: restored };
	} };

	async function open() {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
		const service = createAudioEditorFileService();
		const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(),
			scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'],
			engineFactory: () => assert.fail('MIDI synthesis must not use a substitute audio renderer'),
			ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
			fileService: { ...service, saveFile: async (request: FileRequest = {}) => {
				saved.push(request); return { method: 'node-fixture', fileName: request.suggestedName ?? 'Notes.mid',
					size: request.bytes?.byteLength ?? new TextEncoder().encode(request.text ?? '').length };
			} },
		});
		context.after(async () => { await controller.dispose(); });
		await controller.ready;
		return { controller, store };
	}
}
