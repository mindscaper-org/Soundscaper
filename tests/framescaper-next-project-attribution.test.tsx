/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperCandidateAuthoringActionRuntimeFor } from '../src/common/editor/ui/framescaper-candidate-authoring-actions.ts';
import ProjectMetadataPanel from '../src/common/editor/ui/workspace/ProjectMetadataPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

// Warm the existing lazy panel before the mounted metadata tab selects it.
await import('../src/common/editor/ui/workspace/ProjectAttributionTab.tsx');

test('NP024: the native generated-title project opens its Attribution tab with resolved visual timing', async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
		storageManager: { estimate: async () => ({ usage: 0, quota: 1024 ** 3 }), persisted: async () => true, persist: async () => true } as unknown as StorageManager,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	const authoring = framescaperCandidateAuthoringActionRuntimeFor(controller); assert.ok(authoring); await authoring.run('video-title');
	const runtime = createEditorProjectRuntimeSelection(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
	const project: unknown = controller.project; assert.ok(isRecord(project));
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React'); Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		const props = { controller, project, runtimeProject: runtime.projectForRuntimeConsumers(project), copy: ENGLISH_COPY, disabled: false, onUpdate() {} };
		await act(async () => root.render(<ProjectMetadataPanel {...props} />));
		const tab = dom.container.querySelectorAll('[role="tab"]').find(item => item.textContent === 'Attribution'); assert.ok(tab);
		await act(async () => reactProps(tab).onClick());
		assert.equal(dom.container.textContent.includes('invalid source data'), false, 'a valid native generator must not invalidate all attribution');
		assert.ok(dom.container.textContent.includes('No imported sources are currently used'), 'an authored title is generated media, not a legacy imported source');
	} finally { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore(); }
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
