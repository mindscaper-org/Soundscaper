/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { parseAudacityEffectMacro } from '../../src/common/editor/effect-macros.js';
import { createSoundscaperProjectRuntimeSelection } from '../../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
type Store = ReturnType<typeof createSoundscaperProjectStore>;

/** Import actual file text, reload its durable library, run it, and open its portable result. */
export async function nativeMacroCustody(context: TestContext, project: SoundscaperProject, source: string,
	channels: ReadonlyMap<string, readonly Float32Array[]> = new Map()) {
	const indexedDB = createInstrumentedIndexedDB();
	const createStore = () => createSoundscaperProjectStore({ indexedDB, preferOpfs: false });
	const original = createStore();
	for (const item of project.sources) {
		assert.ok(item.kind === 'audio');
		const writer = await original.beginSourceWrite(item.storageKey, item);
		await writer.write(channels.get(item.id) ?? Array.from({ length: item.channelCount }, () => new Float32Array(item.frameCount).fill(.25)));
		await writer.commit();
	}
	await original.saveProject(project);
	await original.saveSetting('last-project-id', project.id);
	const importer = await controller(original);
	const file = new File([source], 'Native import.txt', { type: 'text/plain' });
	const parsed = parseAudacityEffectMacro(await file.text());
	assert.deepEqual(parsed.ignoredCommands, []);
	const saved = importer.actions.macros.library.save({ name: 'Native import', effects: [...parsed.effects] });
	await importer.actions.macros.library.flush();
	await importer.dispose();

	const sender = createStore();
	const runner = await controller(sender);
	const restored = runner.actions.macros.library.list().find(entry => entry.id === saved.id);
	assert.ok(restored, 'the imported macro must reload from its persisted library');
	assert.equal(restored.name, 'Native import');
	assert.equal(await runner.actions.macros.run(restored), true);
	assert.ok(validateSoundscaperProject(runner.project));
	await runner.actions.project.flush();
	const persisted = await sender.loadProject(runner.project.id);
	assert.ok(validateSoundscaperProject(persisted));
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(runner.project, sender);
	assert.ok(archive.blob instanceof Blob);

	const recipientStore = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const recipient = await controller(recipientStore);
	await recipient.actions.project.openScapeFile(new File([archive.blob], 'Macro result.sscape'), () => 'copy');
	assert.equal(recipient.getSnapshot().readOnly, false);
	assert.ok(validateSoundscaperProject(recipient.project));
	return { project: recipient.project, controller: recipient, store: recipientStore };

	async function controller(store: Store) {
		const runtime = createSoundscaperProjectRuntimeSelection();
		const value = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, store,
			projectRuntime: runtime, sessionController: runtime.createSessionController(), scapeProjectRuntime: createSoundscaperScapeNativeRuntime(),
			engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
		context.after(async () => { await value.dispose(); });
		await value.ready;
		return value;
	}
}
