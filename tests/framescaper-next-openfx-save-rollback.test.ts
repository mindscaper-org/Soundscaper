/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperControllerFoundationViewAssistance } from '../src/framescaper/editor-controller-assistance-foundation-view.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperNativeOpenFxActionRuntimeNativeMedia } from '../src/framescaper/editor-native-openfx-action.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: Error) => void;
	const promise = new Promise<T>((accept, refuse) => { resolve = accept; reject = refuse; });
	return { promise, resolve, reject };
}

for (const mode of ['later-edit', 'unchanged'] as const) test(`NP026 ancillary: failed native OpenFX save protects ${mode} history`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: {
		indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs: false,
	} });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async () => { await controller.dispose(); await environment.close(); }); await controller.ready;
	await controller.actions.project.open(createFramescaperProject(PROFILE, { ...framescaperV20Options(),
		selection: { startFrame: 0, endFrame: 0, trackIds: ['video-track'], clipIds: ['video-clip'] },
	}));
	const entered = deferred<void>(), failed = deferred<void>();
	const originalSave = environment.store.saveProjectIfCurrentWithWriteFence.bind(environment.store); let armed = true;
	environment.store.saveProjectIfCurrentWithWriteFence = async (...args: Parameters<typeof originalSave>) => {
		const effects: unknown = args[1].ofxEffects;
		if (armed && Array.isArray(effects) && effects.length > 0) {
			armed = false; entered.resolve(); await failed.promise;
		}
		return originalSave(...args);
	};
	const foundation = createFramescaperControllerFoundationViewAssistance(controller);
	const owner = { ...foundation, get project() { return foundation.project; },
		actions: { edit: controller.actions.edit, project: { save: controller.actions.project.save } } };
	const plugin = { pluginHandle: '12'.repeat(20), pluginId: 'net.example.Filter', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: 'ab'.repeat(32), supportedContexts: ['filter'],
		parameters: [], components: ['RGBA'], pixelDepths: ['byte'], threading: 'instance-safe', state: 'enabled', quarantined: false } as const;
	const runtime = createFramescaperNativeOpenFxActionRuntimeNativeMedia({ profile: PROFILE, owner, bridge: {
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({ masterEnabled: true, entries: [{ domain: 'ofx', id: 'isolated-host',
			buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true }] }),
		listOpenFxPlugins: async () => [plugin],
	}, mintId: () => 'next-filter' });
	const running = assert.rejects(runtime.actionRuntime.run('ofx-add'), /save failed/u);
	await Promise.race([entered.promise, running.then(() => { throw new Error('OpenFX save never started'); })]);
	if (mode === 'later-edit') await controller.actions.project.rename('Later edit');
	const expected = controller.project;
	failed.reject(new Error('save failed')); await running;
	if (mode === 'unchanged') {
		const project = controller.project; assert.ok(project); assert.ok(Array.isArray(project.ofxEffects)); assert.equal(project.ofxEffects.length, 0);
		controller.actions.edit.redo(); const redone = controller.project; assert.ok(redone); assert.ok(Array.isArray(redone.ofxEffects)); assert.equal(redone.ofxEffects.length, 1);
	} else assert.deepEqual(controller.project, expected, 'the failed save does not own the latest Undo entry');
});
