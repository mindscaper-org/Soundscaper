/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { normalizeSourceProvenance } from '../src/common/editor/source-provenance.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const cases = [
	{ extension: 'raw', desktop: false }, { extension: 'pcm', desktop: false },
	{ extension: 'raw', desktop: true }, { extension: 'pcm', desktop: true },
	{ extension: 'wav', desktop: false },
] as const;

for (const { extension, desktop } of cases) test(`${extension} import and Scape reopen preserve the selected file origin in the ${desktop ? 'desktop slice' : 'browser'} path`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const bytes = extension === 'wav' ? Uint8Array.from(encodeWav([Float32Array.of(.25, -.25)], { sampleRate: 44_100, float: true }))
		: Uint8Array.of(0, 32, 0, 224);
	const input = new File([bytes], `Room.${extension}`, { type: extension === 'wav' ? 'audio/wav' : 'application/octet-stream', lastModified: 1234 });
	if (extension === 'wav') await controller.actions.project.importFiles([input]);
	else await importRawFile(controller, input, desktop);
	const project: unknown = controller.project; assert.ok(validateSoundscaperProject(project));
	const source = project.sources[0]; assert.ok(source?.kind === 'audio');
	const origin = { kind: 'local-file', originalFileName: input.name, mimeType: input.type,
		byteLength: input.size, lastModified: new Date(input.lastModified).toISOString() };
	assert.deepEqual(normalizeSourceProvenance(source.provenance).contributions[0]?.origin, origin);
	assert.equal(source.sampleRate, 44_100); assert.equal(source.frameCount, 2); assert.equal(source.channelCount, 1);
	const pcm: number[] = [];
	for await (const chunk of store.readSourceChunks(source.storageKey)) {
		const channel: unknown = chunk.channels[0]; assert.ok(channel instanceof Float32Array); pcm.push(...channel);
	}
	assert.deepEqual(pcm, [.25, -.25]);
	await controller.actions.project.save();
	const saved = await store.loadProject(project.id);
	assert.deepEqual((saved as typeof controller.project)?.sources[0]?.provenance, source.provenance);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const archive = createSoundscaperScapeNativeRuntime();
	const exported = await archive.exportScapeProject(project, store); assert.ok(exported.blob);
	const reopened = await archive.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false);
	const restoredProject: unknown = reopened.project; assert.ok(validateSoundscaperProject(restoredProject));
	assert.equal(restoredProject.sources.length, 1); assert.equal(restoredProject.clips.length, 1);
	const restored = restoredProject.sources[0]; assert.ok(restored?.kind === 'audio');
	assert.equal(restored.sampleRate, 44_100); assert.equal(restored.frameCount, 2); assert.equal(restored.channelCount, 1);
	assert.deepEqual(normalizeSourceProvenance(restored.provenance).contributions[0]?.origin, origin);
	const chunk = await recipient.readSourceChunk(restored.storageKey, 0); assert.ok(chunk);
	assert.deepEqual(chunk.channels, [Float32Array.of(.25, -.25)]);
});

async function importRawFile(controller: ReturnType<typeof createAudioEditorController>, input: File, desktop: boolean): Promise<void> {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	const running: Promise<unknown>[] = [];
	try {
		await act(async () => root.render(<RawPcmImportDialog controller={controller} copy={ENGLISH_COPY}
			fileService={{ isDesktop: desktop }} onClose={() => undefined}
			run={operation => { const result = Promise.resolve(operation()); running.push(result); return result; }} />));
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { files: [input] } }));
		await act(async () => {
			reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await Promise.all(running);
		});
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
}
