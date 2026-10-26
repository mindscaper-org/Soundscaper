/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createFramescaperDesktopProjectLibraryHandshake } from '../../desktop/framescaper-project-library-contract.ts';
import { FramescaperDesktopProjectLibraryMain } from '../../desktop/framescaper-project-library-main.ts';
import { connectFramescaperDesktopProjectLibraryRenderer } from '../../src/framescaper/desktop-project-library-renderer.ts';
import { createFramescaperDesktopProjectStoreAdapter } from '../../src/framescaper/desktop-project-library-store-adapter.ts';
import { createEditorProjectRuntimeSelection } from '../../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';

type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;

/** Actual renderer/main catalog and controller, with only audio devices replaced. */
export async function nextFramescaperDesktopController(context: TestContext) {
	const path = await mkdtemp(join(tmpdir(), 'next-framescaper-project-'));
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const main = await FramescaperDesktopProjectLibraryMain.start({ appDataPath: path, handshake,
		owner: { product: 'framescaper', processId: 12_015, instanceId: crypto.randomUUID() },
		onLeaseLost: () => undefined, testControl: null });
	const session = main.openSession(handshake);
	const local = createFramescaperProjectStore(PROFILE, { indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager });
	await local.ready();
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'framescaperDesktop');
	const bridge = Object.freeze({ connect: async () => handshake, handshakeState: () => 'admitted',
		listProjects: () => session.listProjects(), readProjectBundle: (id: string) => session.readProjectBundle(id),
		readBodyChunk: (request: unknown) => session.readBodyChunk(request),
		claimProjectWriteFence: (id: string) => Promise.resolve(session.claimProjectWriteFence(id)),
		checkProjectWriteFence: (request: unknown) => session.checkProjectWriteFence(request),
		beginPublication: (request: unknown) => session.beginPublication(request),
		writePublicationChunk: (request: unknown) => session.writePublicationChunk(request),
		finishPublication: (request: unknown) => session.finishPublication(request),
		abortPublication: (request: unknown) => session.abortPublication(request),
		deleteProject: (request: unknown) => session.deleteProject(request),
		duplicateProject: (request: unknown) => session.duplicateProject(request) });
	Object.defineProperty(globalThis, 'framescaperDesktop', { configurable: true, enumerable: true,
		value: Object.freeze({ v1: Object.freeze({ projectLibrary: bridge }) }) });
	const renderer = await connectFramescaperDesktopProjectLibraryRenderer(PROFILE, local); assert.ok(renderer);
	const store = createFramescaperDesktopProjectStoreAdapter(PROFILE, { localStore: local, desktopProjectLibrary: renderer });
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const controller = createAudioEditorController(null, { headless: true, productId: 'framescaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(), store,
		scapeProjectRuntime: archive, engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => {
		await controller.dispose(); await session.close(); await main.close(); await rm(path, { recursive: true, force: true });
		if (previous) Object.defineProperty(globalThis, 'framescaperDesktop', previous);
		else Reflect.deleteProperty(globalThis, 'framescaperDesktop');
	});
	await controller.ready;
	return { controller, store, local, archive, session, renderer };
}
