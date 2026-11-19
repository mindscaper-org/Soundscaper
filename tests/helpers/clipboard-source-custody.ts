/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { assertAudioProjectArchivePcm } from './audio-project-archive-pcm-custody.ts';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

/** Native project/controller custody; playback is never used as a substitute renderer. */
export async function createClipboardCustody(context: TestContext) {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), engine: createMemoryEngine() as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Clipboard custody must not render synthetic audio.'); } });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	return {
		controller, store,
		async open(project: SoundscaperProject, pcm: ReadonlyMap<string, readonly Float32Array[]>): Promise<void> {
			const donor = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
			try {
				for (const source of project.sources) {
					assert.ok(source.kind === 'audio');
					const channels = pcm.get(source.id); assert.ok(channels);
					assert.deepEqual([channels.length, channels[0]?.length], [source.channelCount, source.frameCount]);
					const writer = await donor.beginSourceWrite(source.storageKey, source);
					for (let start = 0; start < source.frameCount; start += 65_536)
						await writer.write(channels.map(channel => channel.subarray(start, start + 65_536)));
					await writer.commit();
				}
				const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, donor); assert.ok(exported.blob);
				await controller.actions.project.openScapeFile(new File([exported.blob], `${project.id}.sscape`), () => 'copy');
				assert.equal(controller.getSnapshot().readOnly, false);
				assert.equal(controller.project?.id, project.id);
			} finally { await donor.close(); }
		},
		async archive(assertSource: (name: string, channels: readonly Float32Array[]) => void) {
			await controller.actions.project.flush();
			return await assertAudioProjectArchivePcm(context, store, controller.project, assertSource);
		},
	};
}

export function clipboardProject(project: unknown): SoundscaperProject {
	assert.ok(validateSoundscaperProject(project)); return structuredClone(project);
}

/** Revisions and transient selection are authored by history; compare every document field. */
export function clipboardDocument(project: SoundscaperProject) {
	const { revision: _revision, updatedAt: _updatedAt, selection: _selection, ...document } = project;
	return document;
}

export function clipboardPcm(frames: number, channel = 0): Float32Array {
	return Float32Array.from({ length: frames }, (_, frame) => ((frame * (channel + 3)) % 257 - 128) / 512);
}
