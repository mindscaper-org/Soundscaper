/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const desktop of [false, true]) test(`Raw Data import preserves the selected file origin in the ${desktop ? 'desktop slice' : 'browser'} path`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client'); const root = createRoot(dom.container as unknown as Element);
	const running: Promise<unknown>[] = [];
	const input = new File([Uint8Array.of(0, 32, 0, 224)], 'Room.raw', { type: 'application/octet-stream', lastModified: 1234 });
	try {
		await act(async () => root.render(<RawPcmImportDialog controller={controller} copy={ENGLISH_COPY}
			fileService={{ isDesktop: desktop }} onClose={() => undefined}
			run={operation => { const result = Promise.resolve(operation()); running.push(result); return result; }} />));
		await act(async () => reactProps(dom.one('input')).onChange({ currentTarget: { files: [input] } }));
		await act(async () => {
			reactProps(dom.one('form')).onSubmit({ preventDefault() {} });
			await Promise.all(running);
		});
		const source = controller.project?.sources[0]; assert.ok(source);
		const provenance = source.provenance as Readonly<{ contributions: readonly Readonly<{ origin: unknown }>[] }>;
		assert.deepEqual(provenance.contributions[0]?.origin, { kind: 'local-file', originalFileName: input.name,
			mimeType: input.type, byteLength: input.size, lastModified: new Date(input.lastModified).toISOString() });
		assert.equal(source.sampleRate, 44_100); assert.equal(source.frameCount, 2);
		const pcm: number[] = [];
		for await (const chunk of store.readSourceChunks(source.storageKey)) {
			const channel: unknown = chunk.channels[0]; assert.ok(channel instanceof Float32Array); pcm.push(...channel);
		}
		assert.deepEqual(pcm, [.25, -.25]);
		await controller.actions.project.save();
		const saved = await store.loadProject(String(controller.project?.id));
		assert.deepEqual((saved as typeof controller.project)?.sources[0]?.provenance, source.provenance);
	} finally {
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore();
	}
});
