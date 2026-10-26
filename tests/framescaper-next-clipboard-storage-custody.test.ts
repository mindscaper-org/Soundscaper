/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperEditorProjectEnvironment } from '../src/framescaper/editor-project-environment.ts';
import { createFramescaperControllerFoundationViewAssistance } from '../src/framescaper/editor-controller-assistance-foundation-view.ts';
import { createFramescaperAudioEditorController } from '../src/framescaper/editor-controller.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperNativeImageSequenceActionRuntimeNativeMedia } from '../src/framescaper/editor-native-image-sequence-action.ts';
import { createNativeMediaCapabilitySnapshotV1 } from '../src/common/editor/native-media-capability-snapshot.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Data = Readonly<Record<string, unknown>>;
function record(value: unknown): Data { assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as Data; }
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

test('NP030: copied native image sequence bodies survive project deletion and export',async context=>{
 const environment=await createFramescaperEditorProjectEnvironment({storeOptions:{indexedDB:createInstrumentedIndexedDB() as unknown as IDBFactory,preferOpfs:false,storageManager:{estimate:async()=>({usage:0,quota:1024**3}),persisted:async()=>true,persist:async()=>true} as unknown as StorageManager}});
 const downloads:Blob[]=[];
 const fileService={isDesktop:false,prepareSave:async()=>({mode:'blob',target:{browserDownload:true}}),saveFile:async({blob}:{blob:Blob})=>{downloads.push(blob);return{fileName:'copy.fscape',size:blob.size}}};
 const controller=createFramescaperAudioEditorController(environment,{fileService});
 context.after(async()=>{await controller.dispose();await environment.close()});await controller.ready;
 const foundation=createFramescaperControllerFoundationViewAssistance(controller),{bridge}=nativeBridge();let minted=0;
 const owner={...foundation,get project(){return foundation.project;},actions:{edit:controller.actions.edit,project:{save:controller.actions.project.save}}};
 const runtime=createFramescaperNativeImageSequenceActionRuntimeNativeMedia({profile:PROFILE,owner,store:environment.store,bridge,mintId:()=>`retention-${++minted}`});
 await runtime.run('image-sequence-import',{frameRate:{num:24,den:1}});
 const before=record(controller.project),source=record((before.sources as unknown[])[0]),sequence=record(source.imageSequence),pack=record(sequence.sourcePack),inventory=record(sequence.inventory);
 const bin=record(before.projectBin),clip=record((bin.clips as unknown[])[0]);
 assert.notEqual(source.id,source.storageKey,'native sequence uses a physical pack key distinct from its logical source');
 controller.actions.projectBin.place(String(clip.id),{timelineStartFrame:0});
 const placed=record((record(controller.project).clips as unknown[])[0]);
 controller.actions.timeline.selectClip(String(placed.id));controller.actions.edit.copy();
 assert.equal(controller.getSnapshot().history.hasClipboard,true);
 await controller.actions.project.save();
 const originalNow=Date.now;Date.now=()=>originalNow()+3*24*60*60*1000;context.after(()=>{Date.now=originalNow});
 await controller.actions.project.remove();
 assert.equal(controller.getSnapshot().history.hasClipboard,true,'Delete keeps the session clipboard');


 await controller.actions.edit.paste();
 assert.equal((record(controller.project).clips as unknown[]).length,1);
 await controller.actions.project.saveScape({saveCopy:false,useFileSystemAccess:false});
 assert.equal(downloads.length,1);
 assert.ok(await environment.store.getMediaAssetMetadata(String(pack.storageKey)));
 assert.ok(await environment.store.getMediaAssetMetadata(String(inventory.storageKey)));
});
