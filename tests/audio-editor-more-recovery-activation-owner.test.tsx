/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectRecoveryDialog from '../src/common/editor/ui/dialogs/ProjectRecoveryDialog.tsx';
import { PROJECT_RECOVERY_COPY_BY_LOCALE } from '../src/common/i18n/editor-project-recovery-copy.ts';
import { RECORDING_RECOVERY_KEY_PREFIX } from '../src/common/editor/storage/recording-recovery-journal-repository.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { bindSoundscaperProjectRecovery } from '../src/soundscaper/editor-project-recovery-binding.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier, context, nextResolve) {
	if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') return { url: 'data:text/javascript,export default "mock-ffmpeg-asset"', shortCircuit: true };
	return nextResolve(specifier, context);
}`)}`, import.meta.url);
const { createSoundscaperAudioEditorController } = await import('../src/soundscaper/editor-controller.ts');
const { createSoundscaperEditorProjectEnvironment } = await import('../src/soundscaper/editor-project-environment.ts');

test('MP59: dismissed pending File Recovery cannot replace a newer workspace', async () => {
	const environment = await createSoundscaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB(), preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true,
			persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createSoundscaperAudioEditorController(environment);
	await controller.ready;
	const original = createSoundscaperProject({ id: 'recover-pending-original', title: 'Original work' });
	await environment.controllerStore.saveProject(original);
	let release = (): void => undefined, entered = (): void => undefined;
	const gate = new Promise<void>(resolve => { release = resolve; });
	const started = new Promise<void>(resolve => { entered = resolve; });
	const repository = environment.controllerStore.analysisRepository;
	const get = repository.get.bind(repository);
	const originKey = `${RECORDING_RECOVERY_KEY_PREFIX}${encodeURIComponent(original.id)}`;
	repository.get = async (key: string) => {
		if (key === originKey) { entered(); await gate; }
		return get(key);
	};
	const dom = installReactTestDom();
	const keyListeners = new Set<EventListenerOrEventListenerObject>();
	const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
	document.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => { if (type === 'keydown' && listener) keyListeners.add(listener); if (listener) add(type, listener, options); };
	document.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) => { if (type === 'keydown' && listener) keyListeners.delete(listener); if (listener) remove(type, listener, options); };
	const root = createRoot(dom.container as unknown as Element);
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = actGlobal.IS_REACT_ACT_ENVIRONMENT; actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	let completion: Promise<unknown> | undefined;
	const recovery = controller.actions.project.recovery;
	let receipt: Parameters<typeof recovery.recover>[0] | undefined;
	let candidateIndex = -1;
	function Surface() {
		const [open, setOpen] = useState(true);
		return open ? <ProjectRecoveryDialog initialProjectId={original.id} copy={{ ...PROJECT_RECOVERY_COPY_BY_LOCALE.en, close: 'Close' }}
			actions={{ ...recovery, recover(inspection, index) { receipt = inspection; candidateIndex = index; completion = recovery.recover(inspection, index); return completion; } }}
			run={operation => operation()} onClose={() => setOpen(false)} /> : null;
	}
	try {
		await act(async () => { root.render(<Surface />); await new Promise<void>(resolve => setImmediate(resolve)); });
		for (let index = 0; index < 30 && !dom.container.textContent.includes(PROJECT_RECOVERY_COPY_BY_LOCALE.en.projectRecoveryUsable); index++) {
			await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 10)); });
		}
		const button = dom.container.querySelectorAll('button').find(value => value.textContent === PROJECT_RECOVERY_COPY_BY_LOCALE.en.projectRecoveryCreate);
		assert.ok(button); assert.equal(reactProps(button).disabled, false);
		await act(async () => { reactProps(button).onClick(); await started; });
		await act(async () => {
			let prevented = false;
			const event = { key: 'Escape', get defaultPrevented() { return prevented; }, isComposing: false,
				preventDefault() { prevented = true; } } as KeyboardEvent;
			for (const listener of keyListeners) { if (typeof listener === 'function') listener(event); else listener.handleEvent(event); }
		});
		assert.equal(dom.find('[data-project-recovery-dialog="true"]'), null);
		await controller.actions.project.create({ title: 'New workspace after dismissal' });
		const newer = controller.project; assert.ok(newer);
		release();
		await act(async () => { await completion?.catch(() => undefined); });
		assert.equal(controller.project?.id, newer.id, 'old recovery must not activate over File New');
		assert.ok(completion); await assert.rejects(completion, { code: 'PROJECT_CHANGED' });
		assert.ok(receipt);
		const beforeRetry = await environment.controllerStore.listProjects();
		const retried = await recovery.recover(receipt, candidateIndex);
		assert.equal(controller.project?.id, retried.project.id);
		assert.equal((await environment.controllerStore.listProjects()).length, beforeRetry.length, 'retry reuses the published copy');
	} finally {
		release(); await completion?.catch(() => undefined);
		await act(async () => root.unmount()); actGlobal.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore();
		await controller.dispose(); await environment.close();
	}
});

test('MP59: startup recovery can activate a copy when no document is open', async context => {
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	context.after(async () => { await store.close(); });
	const original = createSoundscaperProject({ id: 'recover-startup-empty' });
	await store.saveProject(original);
	let active: { readonly id: string } | null = null;
	const recovery = bindSoundscaperProjectRecovery(store, project => { active = project; }, {
		get project() { return active; },
		captureProjectGeneration() { throw new Error('There is no active project generation to capture.'); },
		assertProjectGeneration() { throw new Error('There is no active project generation to assert.'); },
	});
	const inspection = await recovery.inspect(original.id);
	const result = await recovery.recover(inspection, 0);
	assert.equal((active as { readonly id: string } | null)?.id, result.project.id);
});
