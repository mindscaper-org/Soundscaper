/* SPDX-License-Identifier: AGPL-3.0-only */

import { createLocalizedError, setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import { isAudioMediaKind } from '../../../../audio-media-kind.ts';
import { hasCoreEditingProjectAuthority } from '../../../../project-schema-version.ts';
import { confirmFileSizeWarning } from '../../../shared/file-size-warning.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE,
	isCurrentAssertion,
	type EditorProjectToken,
	type EditorTaskScope,
} from '../../../shared/lifecycle.ts';
import type {
	Aup4Environment,
	Aup4PortableOptions,
	Aup4SnapshotSource,
	Aup4Validation,
	AudacityProjectGeneration,
	NativeAup4Client,
	NativeCompatibilityReport,
	NativeProgress,
	NativeProjectAudioSource,
	NativeProjectDocument,
	NativeProjectServiceRuntime,
	NativeSavedFile,
	NativeStorageEstimate,
	SaveAup3Options,
	SaveAup4Options,
} from '../../native-project-types.ts';
import type { ProjectTask } from './native-project-ownership.ts';
import { withAudacityWorkerSizeAdmission } from './audacity-worker-size-admission.ts';

type SaveResult = Readonly<NativeSavedFile & {
	validation: Aup4Validation;
	compatibilityReport: NativeCompatibilityReport;
}> | Readonly<{ cancelled: true }>;

interface AudacityProjectSaveDependencies {
	readonly assertOwnership: (task: EditorTaskScope, token: EditorProjectToken) => void;
	readonly beginProjectTask: (name: string, expectedProjectId?: string, options?: Readonly<{ scope?: string | null }>) => ProjectTask;
	readonly beginSave: (task: EditorTaskScope, token: EditorProjectToken, snapshot?: NativeProjectDocument) => void;
	readonly failSave: (task: EditorTaskScope, token: EditorProjectToken) => void;
	readonly finishSave: (task: EditorTaskScope, token: EditorProjectToken, state: 'saved') => boolean;
	readonly getClient: () => Promise<NativeAup4Client>;
	readonly getEnvironment: () => Aup4Environment | null;
	readonly rememberCompatibilityReport: (
		report: unknown, direction: 'open' | 'save', expectedProjectId?: string,
	) => NativeCompatibilityReport;
	readonly requireOwnedProject: (projectId: string) => NonNullable<ReturnType<NativeProjectServiceRuntime['getProject']>>;
	readonly requireProject: () => NonNullable<ReturnType<NativeProjectServiceRuntime['getProject']>>;
	readonly updateProgress: (
		progress: NativeProgress,
		prefix: string,
		task: EditorTaskScope,
		projectToken: EditorProjectToken,
		localization: Readonly<{ key: string }>,
	) => void;
}

interface AudacitySaveTarget {
	readonly generation: AudacityProjectGeneration;
	readonly idPrefix: string;
	readonly onlyV2Key: string;
	readonly savedKey: string;
	readonly savingCopy: string;
	readonly savingKey: string;
	readonly ensureFileName: (value: unknown) => string;
	readonly requestFileHandle: (options: Readonly<{ fileName: string }>) => Promise<unknown>;
	readonly saveResult: NativeProjectServiceRuntime['saveAup4Result'];
	readonly updatesProjectSaveState: boolean;
}

export function createNativeAudacityProjectSave(
	runtime: NativeProjectServiceRuntime,
	dependencies: AudacityProjectSaveDependencies,
) {
	const saveAup3 = (options: SaveAup3Options = {}): Promise<SaveResult> => saveProject('aup3', options);
	const saveAup4 = (options: SaveAup4Options = {}): Promise<SaveResult> => saveProject('aup4', options);

	async function saveProject(
		generation: AudacityProjectGeneration,
		options: SaveAup3Options | SaveAup4Options,
	): Promise<SaveResult> {
		const target = saveTarget(generation);
		const updatesSaveState = target.updatesProjectSaveState && !options.saveFile;
		let snapshot = dependencies.requireProject();
		if (!hasCoreEditingProjectAuthority(snapshot)) {
			throw createLocalizedError(Error, runtime.copy, target.onlyV2Key);
		}
		if (runtime.hasMissingTimelineSources(snapshot, { audioOnly: true })
			|| runtime.reportHasMissingPcm(runtime.sessionTab(snapshot.id)?.metadata?.aup4CompatibilityReport)) {
			throw createLocalizedError(Error, runtime.copy, 'missingSourcesPreventSave');
		}
		if (runtime.state.readOnly && !options.saveCopy) {
			throw createLocalizedError(Error, runtime.copy, 'projectReadOnly');
		}
		const operation = dependencies.beginProjectTask(
			'native-project-save', snapshot.id, { scope: EDITOR_PROJECT_TASK_SCOPE },
		);
		const signal = operation.task.signal;
		let fileHandle = options.fileHandle;
		let saveDestination = options.saveTarget;
		let client: NativeAup4Client | null = null;
		let nativeId: string | null = null;
		let nativeCreated = false;
		try {
			if (!options.saveFile && runtime.fileService.isDesktop && saveDestination === undefined) {
				try {
					saveDestination = await runtime.fileService.chooseSaveTarget({
						purpose: target.generation,
						suggestedName: target.ensureFileName(options.fileName || snapshot.title),
						mimeType: 'application/x-audacity-project',
					});
				} catch (error) {
					if (isAbortError(error)) return { cancelled: true };
					throw error;
				}
				dependencies.assertOwnership(operation.task, operation.projectToken);
				if (!saveDestination) return { cancelled: true };
			} else if (!options.saveFile && !fileHandle && options.useFileSystemAccess !== false) {
				try {
					fileHandle = await target.requestFileHandle({ fileName: options.fileName || snapshot.title });
				} catch (error) {
					if (isAbortError(error)) return { cancelled: true };
					throw error;
				}
				dependencies.assertOwnership(operation.task, operation.projectToken);
			}
			snapshot = dependencies.requireOwnedProject(snapshot.id);
			const exportSnapshot = runtime.prepareAudacityProjectExport
				? await runtime.prepareAudacityProjectExport(snapshot) : snapshot;
			dependencies.assertOwnership(operation.task, operation.projectToken);
			client = await dependencies.getClient();
			dependencies.assertOwnership(operation.task, operation.projectToken);
			nativeId = sanitizeNativeId(runtime.createStableId(target.idPrefix));
			const referencedSources = exportSnapshot.sources.filter((source): source is NativeProjectAudioSource => (
				isAudioMediaKind(source.kind)
					&& exportSnapshot.clips.some((clip) => isAudioMediaKind(clip.kind) && clip.sourceId === source.id)
			));
			const sourceBytes = referencedSources.reduce(
				(total, source) => total + runtime.sourcePcmBytes(source), 0,
			);
			const workingBytes = referencedSources.reduce(
				(maximum, source) => Math.max(maximum, runtime.sourcePcmBytes(source)), 0,
			);
			await runtime.preflightStorage(sourceBytes, 'export');
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const storage = await runtime.store.estimateStorage();
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const progress = (value: NativeProgress) => dependencies.updateProgress(
				value, target.savingCopy,
				operation.task, operation.projectToken, { key: target.savingKey },
			);
			const portable = portableOptions(
				runtime, dependencies.getEnvironment(), workingBytes, storage, progress, signal,
			);
			const { getAup4SaveLimit } = await import('../../../../aup4-profile.js'); const threshold = getAup4SaveLimit({ mobile: runtime.state.mobile, opfs: portable.opfs,
				deviceMemory: (globalThis.navigator as Navigator & { deviceMemory?: number } | undefined)?.deviceMemory });
			const estimatedBytes = Math.ceil(sourceBytes * 1.02) + 2 * 1024 * 1024;
			const maxBytes = await confirmFileSizeWarning(estimatedBytes, threshold,
				target.ensureFileName(options.fileName || snapshot.title), {
					confirmFileSizeWarning: runtime.confirmFileSizeWarning, signal,
					assertCurrent: () => dependencies.assertOwnership(operation.task, operation.projectToken),
				});
			let admittedPortable: Aup4PortableOptions = { ...portable, maxBytes, fileSizeWarningApproved: maxBytes > threshold };
			setLocalizedStatus(runtime.setStatus, runtime.copy, target.savingKey);
			if (updatesSaveState) {
				dependencies.beginSave(operation.task, operation.projectToken, exportSnapshot);
			}
			await client.create(nativeId, { targetGeneration: target.generation, signal });
			nativeCreated = true;
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const warningOptions = { confirmFileSizeWarning: runtime.confirmFileSizeWarning, signal,
				assertCurrent: () => dependencies.assertOwnership(operation.task, operation.projectToken) };
			const writingClient = client, writingNativeId = nativeId;
			const written = await withAudacityWorkerSizeAdmission((workerOptions) => {
				admittedPortable = workerOptions;
				return writingClient.writeSnapshot(writingNativeId, exportSnapshot,
					readAudacitySourceAudio(runtime, referencedSources, operation, dependencies.assertOwnership), workerOptions);
			},
				admittedPortable, target.ensureFileName(options.fileName || snapshot.title), warningOptions, 'preflight');
			dependencies.assertOwnership(operation.task, operation.projectToken);
			await client.commit(nativeId, { signal });
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const result = await withAudacityWorkerSizeAdmission((workerOptions) => writingClient.export(writingNativeId, workerOptions),
				admittedPortable, target.ensureFileName(options.fileName || snapshot.title), warningOptions, 'export');
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const validation = result.validation || await client.inspect(nativeId);
			dependencies.assertOwnership(operation.task, operation.projectToken);
			const rawReport = written.compatibilityReport || result.compatibilityReport || validation.compatibilityReport;
			const compatibilityReport = runtime.normalizeCompatibilityReport(rawReport, 'save');
			const saved = await target.saveResult(result, {
				fileName: options.fileName || snapshot.title,
				fileHandle,
				fileService: options.saveFile ? { ...runtime.fileService, saveFile: options.saveFile } : runtime.fileService,
				saveTarget: saveDestination,
				signal,
			});
			if (saved.cancelled) {
				if (updatesSaveState) {
					dependencies.failSave(operation.task, operation.projectToken);
				}
				return { cancelled: true };
			}
			// A successful destination acknowledgement is final even if File New or
			// Cancel superseded this task while the file was being committed.
			const mayPublish = updatesSaveState
				? dependencies.finishSave(operation.task, operation.projectToken, 'saved')
				: isCurrentAssertion(() => dependencies.assertOwnership(operation.task, operation.projectToken));
			if (mayPublish) {
				dependencies.rememberCompatibilityReport(rawReport, 'save', snapshot.id);
				setLocalizedStatus(runtime.setStatus, runtime.copy, target.savedKey, undefined, 'success');
				runtime.publishDocumentSnapshot();
			}
			return { ...saved, validation, compatibilityReport };
		} catch (error) {
			if (updatesSaveState) {
				dependencies.failSave(operation.task, operation.projectToken);
			}
			throw error;
		} finally {
			if (nativeCreated && nativeId) await closeNativeProject(client, nativeId);
			operation.task.finish();
		}
	}

	function saveTarget(generation: AudacityProjectGeneration): AudacitySaveTarget {
		if (generation === 'aup3') return {
			generation,
			idPrefix: 'aup3-export',
			onlyV2Key: 'aup3OnlyV2',
			savedKey: 'aup3Saved',
			savingCopy: runtime.copy.aup3Saving,
			savingKey: 'aup3Saving',
			ensureFileName: runtime.ensureAup3FileName,
			requestFileHandle: runtime.requestAup3FileHandle,
			saveResult: runtime.saveAup3Result,
			updatesProjectSaveState: false,
		};
		return {
			generation,
			idPrefix: 'aup4-export',
			onlyV2Key: 'aup4OnlyV2',
			savedKey: 'aup4Saved',
			savingCopy: runtime.copy.aup4Saving,
			savingKey: 'aup4Saving',
			ensureFileName: runtime.ensureAup4FileName,
			requestFileHandle: runtime.requestAup4FileHandle,
			saveResult: runtime.saveAup4Result,
			updatesProjectSaveState: true,
		};
	}

	return Object.freeze({ saveAup3, saveAup4 });
}

async function* readAudacitySourceAudio(
	runtime: NativeProjectServiceRuntime,
	sources: readonly NativeProjectAudioSource[],
	operation: ProjectTask,
	assertOwnership: AudacityProjectSaveDependencies['assertOwnership'],
): AsyncGenerator<Aup4SnapshotSource> {
	for (const source of sources) {
		assertOwnership(operation.task, operation.projectToken);
		const buffer = runtime.sourceBuffers.get(source.id);
		const channels = buffer
			? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
			: await readStoredAudacityChannels(runtime, source, operation.task.signal);
		assertOwnership(operation.task, operation.projectToken);
		if (!channels?.length) {
			throw createLocalizedError(Error, runtime.copy, 'sourcePcmUnavailable', {
				source: source.name || source.id,
			});
		}
		yield { sourceId: source.id, sampleRate: source.sampleRate, channels };
	}
}

/** Audacity can downmix wider sources; StaffPad's stereo-only loader cannot. */
async function readStoredAudacityChannels(
	runtime: NativeProjectServiceRuntime,
	source: NativeProjectAudioSource,
	signal: AbortSignal,
): Promise<readonly Float32Array[] | null | undefined> {
	if (!runtime.store.readSourceChunks) return runtime.loadStoredSourceChannels(runtime.store, source);
	signal.throwIfAborted();
	const channels = Array.from({ length: source.channelCount }, () => new Float32Array(source.frameCount));
	let offset = 0;
	for await (const chunk of runtime.store.readSourceChunks(source.storageKey || source.id, { signal })) {
		signal.throwIfAborted();
		const packet: readonly Float32Array[] = 'channels' in chunk ? chunk.channels : chunk;
		const frames = packet[0]?.length ?? 0;
		if (packet.length !== source.channelCount || frames < 1 || offset + frames > source.frameCount
			|| packet.some(channel => !(channel instanceof Float32Array) || channel.length !== frames)) {
			throw new Error(`Audacity source ${source.id} has invalid stored PCM chunks.`);
		}
		for (let channel = 0; channel < channels.length; channel += 1) channels[channel]!.set(packet[channel]!, offset);
		offset += frames;
	}
	signal.throwIfAborted();
	if (offset !== source.frameCount) throw new Error(`Audacity source ${source.id} ended early.`);
	return channels;
}

function portableOptions(
	runtime: NativeProjectServiceRuntime,
	environment: Aup4Environment | null,
	workingBytes: number,
	storage: Readonly<Partial<NativeStorageEstimate>>,
	onProgress: (progress: NativeProgress) => void,
	signal: AbortSignal,
): Aup4PortableOptions {
	return {
		mobile: runtime.state.mobile,
		opfs: environment?.opfs,
		quota: storage.quota ?? undefined,
		usage: storage.usage ?? undefined,
		workingBytes,
		onProgress,
		signal,
	};
}

function sanitizeNativeId(value: string): string {
	return value.replace(/[^a-z0-9_-]/gi, '-');
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === 'AbortError';
}

async function closeNativeProject(client: NativeAup4Client | null, nativeId: string): Promise<void> {
	if (!client) return;
	try {
		if (typeof client.delete === 'function') await client.delete(nativeId);
		else await client.close?.(nativeId);
	} catch {
		// Staging cleanup is best-effort and must not mask the save result.
	}
}
