/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalAssistanceVideoKeyingPublication, createLocalAssistanceVideoKeyingWorkflow,
	createLocalAssistanceVideoKeyingFramePreparation, CORRIDORKEY_MODEL_ID, CORRIDORKEY_MODEL_VERSION,
	type LocalAssistanceKeyedVideoInspection } from '../common/editor/controller/assistance/local-assistance-video-keying.ts';
import { publishImportedVideo } from '../common/editor/controller/import/import-video-publication.ts';
import { loadVideoExportOriginal } from '../common/editor/controller/export/video-export-original-loader.ts';
import { createStorageCapacityService } from '../common/editor/controller/shared/storage-capacity-service.ts';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import { createStableId } from '../common/editor/stable-id.js';
import type { FramescaperCorridorKeyRequest } from '../common/editor/ui/framescaper-corridorkey-runtime.ts';
import type { VideoTimingMediaStore } from '../common/editor/video-timing-storage.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { selectAudioEditorEditBlock } from '../common/editor/edit-blocking.ts';

type Data = Readonly<Record<string, unknown>>;
export interface CorridorKeyController {
	readonly project: unknown;
	getSnapshot(): Data;
	captureProjectGeneration(): unknown;
	assertProjectGeneration(token: unknown): void;
	readonly actions: Readonly<{
		edit: Readonly<{ commit(command: unknown): unknown }>;
		project: Readonly<{ save(): unknown }>;
		video: Readonly<{ reloadSourceVisual(id: string): PromiseLike<unknown> }>;
	}>;
}

/** Compose only when the menu-owned tool actually runs; the runtime and model are never implied. */
export async function runFramescaperCorridorKey(controller: CorridorKeyController,
	store: AudioEditorProjectStore, request: FramescaperCorridorKeyRequest): Promise<Readonly<{ sourceId: string }>> {
	const encoder = request.bridge.videoKeying;
	if (!encoder) throw new Error('The authenticated CorridorKey alpha-video encoder is unavailable.');
	request.signal?.throwIfAborted();
	if (!await encoder.available()) throw new Error('Configure an external FFmpeg with the libvpx-vp9 encoder and decoder, WebM muxer and alphaextract filter before using CorridorKey.');
	request.signal?.throwIfAborted();
	let inspection: (LocalAssistanceKeyedVideoInspection & Readonly<{ sha256: string }>) | null = null;
	const capacity = createStorageCapacityService({ estimateStorage: () => store.estimateStorage(),
		isInactive: () => controller.project === null, setSnapshot() {}, publish() {},
		copy: { storageOperationRecording: 'Recording', storageOperationExport: 'Export', storageOperationEffect: 'CorridorKey',
			storageOperationProject: 'Project', storageOperationImport: 'Import',
			insufficientStorage: 'Not enough storage for {operation}: {required}.', formatBytes: (bytes) => `${String(bytes)} bytes` },
	});
	const publication = createLocalAssistanceVideoKeyingPublication({
		getProject: () => controller.project,
		getSelectedClipId: () => { const id = controller.getSnapshot().selectedClipId; return typeof id === 'string' ? id : null; },
		isReadOnly: () => selectAudioEditorEditBlock(controller.getSnapshot()).blocked,
		captureProject: () => controller.captureProjectGeneration(), assertProject: (token) => controller.assertProjectGeneration(token),
		createId: createStableId, preflightStorage: (bytes) => capacity.preflightStorage(bytes, 'effect'),
		store: store as unknown as VideoTimingMediaStore,
		publishContent: async ({ storageKey, body, metadata, signal }) => (
			(await publishImportedVideo(store, storageKey, body, metadata, signal)).publication
		),
		inspectOutput: async (body, options) => {
			if (!inspection || await digestMediaContent(body, options) !== inspection.sha256) throw new Error('The encoded keying inspection lost its authenticated body.');
			return inspection;
		},
		commit: (command) => { controller.actions.edit.commit(command); },
		reloadSourceVisual: async (id) => { await controller.actions.video.reloadSourceVisual(id); await controller.actions.project.save(); },
	});
	const prepareFrames = createLocalAssistanceVideoKeyingFramePreparation({
		loadOriginal: async (run, signal) => loadVideoExportOriginal({
			store: { loadMediaAsset: async (key, options) => {
				const loaded = await store.loadMediaAsset(key, options);
				if (loaded === null || loaded instanceof Blob) return loaded;
				return new Blob([await loaded.arrayBuffer()], { type: loaded.type });
			}, resolveLinkedVideoOriginal: async (projectId, source, options) => {
				const resolved = await store.resolveLinkedVideoOriginal(projectId, source as never, options);
				if (!resolved) return null;
				const body = resolved.blob;
				return { blob: body, binding: resolved.binding };
			} },
			project: controller.project, sourceId: String(run.source.id), storageKey: String(run.source.storageKey),
			signal, assertCurrent: () => publication.assertCurrent(run, signal),
		}),
	});
	const workflow = createLocalAssistanceVideoKeyingWorkflow({ publication, prepareFrames, bridge: request.bridge,
		preflightModel: request.preflightModel,
		encodeAlphaWebm: async ({ jobId, run, outputs, signal, assertCurrent }) => {
			assertCurrent();
			const encoded = await encoder.encode({ contractVersion: 1, jobId, sourceId: String(run.source.id), frameRate: run.frameRate, outputs });
			assertCurrent();
			const body = await request.bridge.readOutput({ jobId, claim: encoded.claim });
			signal.throwIfAborted(); assertCurrent(); inspection = encoded.inspection;
			return { body, sha256: encoded.claim.sha256, modelId: CORRIDORKEY_MODEL_ID, modelVersion: CORRIDORKEY_MODEL_VERSION };
		},
	});
	return workflow.run(request);
}
