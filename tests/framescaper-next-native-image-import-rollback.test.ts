/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperControllerFoundationViewAssistance } from '../src/framescaper/editor-controller-assistance-foundation-view.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperNativeImageSequenceActionRuntimeNativeMedia } from '../src/framescaper/editor-native-image-sequence-action.ts';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { selectAudioEditorBusyBlock } from '../src/common/editor/edit-blocking.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Readonly<Record<string, unknown>>;
function record(value: unknown): Data { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Data; }
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; }
function nativeBridge() {
	const transactionId = 'f'.repeat(40), bodies = new Map<string, Uint8Array>();
	const bytes = Uint8Array.of(1,2,3);
	const control: string[] = [];
	const bridge = {
		capabilities: async () => createNativeMediaCapabilitySnapshotV1({ masterEnabled: true, entries: [{ domain: 'operation', id: 'image-sequence-import', buildSupported: true, probeSucceeded: true, selfTestPassed: true, userEnabled: true }] }),
		selectImageSequence: async () => ({ selectionId: 'a'.repeat(40), files: [{ fileId: 'b'.repeat(40), name: 'shot.0001.png', byteLength: bytes.length }] }),
		readImageSequenceFile: async ({ offset, length }: { offset: number; length: number }) => bytes.slice(offset, offset+length),
		releaseImageSequence: async () => true,
		imageSequenceImport: async (value: unknown) => {
			const request = record(value), operation = String(request.operation); control.push(operation);
			if(operation === 'admit') { const admission = record(request.admission); return { operation: 'admitted', transactionId, result: {
				kind: admission.kind, admitted: true, schemaFamily: admission.schemaFamily, schemaVersion: admission.schemaVersion,
				projectId: admission.projectId, projectRevision: admission.projectRevision, sourceId: admission.sourceId,
				inventorySha256: record(admission.inventory).sha256, sourcePackSha256: record(admission.sourcePack).sha256,
				characteristics: { backend: 'framescaper-media-host', codedWidth: 1920, codedHeight: 1080, hasAlpha: false,
					videoCodec: 'png', bitDepth: 8, pixelFormat: 'rgb24', chromaFormat: '4:4:4', alphaMode: null, alphaInterpretation: null,
					colour: { primaries:'srgb', transfer:'iec61966-2-1', matrix:'rgb', range:'full' } },
			} }; }
			return { operation: ({ begin:'begun', commit:'committed', complete:'completed', discard:'discarded' } as Record<string,string>)[operation], transactionId };
		},
		writeImageSequenceImportChunk: async ({ asset, offset, bytes: chunk }: { asset: string; offset: number; bytes: Uint8Array }) => {
			const prior = bodies.get(asset) ?? new Uint8Array(); const next = new Uint8Array(Math.max(prior.length,offset+chunk.length)); next.set(prior); next.set(chunk,offset); bodies.set(asset,next); return { operation:'written' };
		},
		readImageSequenceImportBody: async ({ asset, offset, length }: { asset: string; offset: number; length: number }) => (bodies.get(asset) ?? new Uint8Array()).slice(offset,offset+length),
	};
	return { bridge, control };
}

for (const mode of ['same-project-edit', 'unchanged'] as const) test(`NP026: failed native image import save retains ${mode} history and body ownership`, async context => {
	const environment = await createFramescaperEditorProjectEnvironment({ storeOptions: { indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory, preferOpfs:false,
		storageManager:{ estimate: async () => ({ usage:0,quota:1024**3 }), persisted:async()=>true,persist:async()=>true } as unknown as StorageManager } });
	const controller = createFramescaperAudioEditorController(environment);
	context.after(async()=>{ await controller.dispose(); await environment.close(); }); await controller.ready;
	const entered = deferred<void>(), failed = deferred<void>(); const { bridge, control } = nativeBridge(); let minted = 0;
	const originalSave = environment.store.saveProjectIfCurrentWithWriteFence.bind(environment.store); let armed = true;
	environment.store.saveProjectIfCurrentWithWriteFence = async (...args: Parameters<typeof originalSave>) => {
		if (armed && Array.isArray(args[1].sources) && args[1].sources.some(source => record(source).imageSequence != null)) {
			armed = false; entered.resolve(); await failed.promise;
		}
		return originalSave(...args);
	};
	const foundation = createFramescaperControllerFoundationViewAssistance(controller);
	const owner = { ...foundation, get project(){ return foundation.project; },
		actions: { edit: controller.actions.edit, project: { save: controller.actions.project.save } } };

	const runtime = createFramescaperNativeImageSequenceActionRuntimeNativeMedia({ profile:PROFILE, owner, store:environment.store, bridge, mintId:()=>`next-sequence-${++minted}` });
	const running = assert.rejects(runtime.run('image-sequence-import',{ frameRate:{num:24,den:1} }));
	await entered.promise;
	assert.equal(selectAudioEditorBusyBlock(controller.getSnapshot()).blocked,false,'File New is enabled while this native save awaits');
	const published: unknown = controller.project;
	const originId = record(published).id; assert.equal(typeof originId, 'string');
	if (mode === 'same-project-edit') await controller.actions.project.rename('Later edit');
	const incoming: unknown = controller.project;
	failed.reject(new Error('save failed')); await running;
	if (mode === 'unchanged') {
		assert.equal(record(controller.project).sources instanceof Array, true);
		assert.equal((record(controller.project).sources as unknown[]).length, 0, 'the exact original import may roll back');
		controller.actions.edit.redo();
		assert.equal((record(controller.project).sources as unknown[]).length, 1, 'Redo retains the imported sequence');
	} else assert.deepEqual(controller.project,incoming,'the outgoing import must never undo a later document or activation');
	const sources = record(published).sources; assert.ok(Array.isArray(sources));
	const sequence = record(record(sources[0]).imageSequence);
	for (const field of ['sourcePack', 'inventory']) { const asset = record(sequence[field]);
		assert.ok(await environment.store.getMediaAssetMetadata(String(asset.storageKey)), `the ${field} remains readable for Undo/Redo`); }
	assert.equal(control.includes('discard'), false, 'main-owned bodies also remain rooted after an acknowledged publication');
});
