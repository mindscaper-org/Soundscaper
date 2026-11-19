/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import React, { act, useState, useSyncExternalStore } from 'react';
import FramescaperFinishingDialog from '../../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import type { FramescaperCaptionFileService } from '../../src/common/editor/ui/framescaper-caption-file-interchange.ts';
import type { FramescaperFinishingSurface } from '../../src/common/editor/ui/framescaper-finishing-menu.ts';
import { createFramescaperAudioEditorController } from '../../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../../src/framescaper/editor-project-environment.ts';
import { cloneFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createInstrumentedIndexedDB } from './instrumented-indexeddb.js';
import { createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { mountControllerDataDom } from './controller-data-dom.ts';
import { reactProps, type ReactTestElement } from './react-test-dom.ts';

/** Real product publication/history/repository; IndexedDB's API is fixture-backed in Node. */
export async function framescaperLifetimeController(context: TestContext, pcmImport = false) {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }),
			persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = await (async () => {
		try {
			if (!pcmImport) return createFramescaperAudioEditorController(environment);
			// The shared public controller uses the actual Framescaper document/session/store owners.
			// Only the hardware playback/buffer allocation port is supplied; WAV parsing produces all PCM.
			type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
			return createAudioEditorController(null, { headless: true, productId: 'framescaper',
				store: environment.controllerStore, projectRuntime: environment.runtime,
				sessionController: environment.runtime.createSessionController(), playbackProjectService: environment.playback,
				createProjectIfAbsent: environment.createProjectIfAbsent, scapeProjectRuntime: createFramescaperScapeNativeRuntime(PROFILE),
				engine: { ...createMemoryEngine(), decodeAudioData: () => { throw new Error('WAV lifetime must use its real PCM reader.'); } } as unknown as Options['engine'],
				engineFactory: () => { throw new Error('Lifetime ownership does not render PCM.'); },
			});
		}
		catch (error) { await environment.close(); throw error; }
	})();
	context.after(async () => { try { await controller.dispose(); } finally { await environment.close(); } });
	await controller.ready;
	return { controller, environment, async persisted() {
		await act(async () => { await controller.actions.project.flush(); });
		const project = cloneFramescaperProject(PROFILE, controller.project);
		assert.deepEqual(await environment.store.loadProject(project.id), project);
		return project;
	} };
}

type Controller = Awaited<ReturnType<typeof framescaperLifetimeController>>['controller'];
type Dom = ReturnType<typeof mountControllerDataDom>;

/** Subscription and dialog retirement are the production React boundary, not a copied reducer. */
export function LifetimeFinishingDialog({ controller, fixture, surface, fileService }: Readonly<{
	controller: Controller; fixture: Dom; surface: FramescaperFinishingSurface; fileService: FramescaperCaptionFileService;
}>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	const [closed, setClosed] = useState(false);
	return closed ? null : <FramescaperFinishingDialog surface={surface} controller={controller}
		project={snapshot.project} editingBlocked={false} readOnly={false} fileService={fileService}
		run={fixture.run} onClose={() => { setClosed(true); }} />;
}

export function lifetimeButton(root: ReactTestElement, label: string): ReactTestElement {
	const button = root.querySelectorAll('button').find(node => node.textContent.trim() === label
		|| node.getAttribute('aria-label') === label);
	assert.ok(button, `Missing ${label}`);
	return button;
}

export function lifetimeChange(root: ReactTestElement, label: string, value: string): void {
	const input = root.querySelectorAll('input').find(node => node.getAttribute('aria-label') === label)
		?? root.querySelectorAll('textarea').find(node => node.getAttribute('aria-label') === label)
		?? root.querySelectorAll('label').find(node => node.querySelector('span')?.textContent === label)?.querySelector('input,textarea');
	assert.ok(input, `Missing ${label}`);
	reactProps(input).onChange({ currentTarget: { value }, target: { value } });
}

