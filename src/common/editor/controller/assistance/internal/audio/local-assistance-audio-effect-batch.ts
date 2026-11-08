/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	LocalAssistanceAudioEffectBatch,
	LocalAssistanceAudioEffectWorkflowId,
	LocalAssistanceSelectedMediaPreparationPort,
} from '../../../../assistance/local-assistance-preparation.ts';
import { AssistanceProposalStaleError } from '../../../../assistance/proposal-session.ts';
import type { DeferredLocalAssistanceRuntimeDependencies } from '../../deferred-local-assistance-runtime.ts';
import { resolveLocalAssistanceSelectedMediaAuthority } from '../local-assistance-selected-media.ts';
import { localAssistanceAudioEffectTargets } from './local-assistance-audio-effect-targets.ts';
import type { LocalAssistanceAudioPublicationStore, LocalAssistanceAudioSourceWriter } from './local-assistance-audio-publication.ts';

type DataRecord = Readonly<Record<string, unknown>>;
type CommitSelection = Readonly<{ selectClipId: string; selectTrackId: string }>;
interface StagedEdit { readonly commands: readonly DataRecord[]; readonly selection: CommitSelection }
const OPERATIONS = Object.freeze({ 'enhance-dialogue': 'speech-enhancement',
	'reduce-reverb': 'dereverberation', 'separate-dialogue-music-effects': 'source-separation' } as const);

/** All inference keeps per-occurrence fences; only the final batch gains document authority. */
export function createLocalAssistanceAudioEffectBatch(
	dependencies: DeferredLocalAssistanceRuntimeDependencies,
	workflowId: LocalAssistanceAudioEffectWorkflowId,
	createPreparation: (dependencies: DeferredLocalAssistanceRuntimeDependencies) => LocalAssistanceSelectedMediaPreparationPort,
): LocalAssistanceAudioEffectBatch {
	if (!Object.hasOwn(OPERATIONS, workflowId)) throw new RangeError('This workflow is not an audio effect.');
	const store = dependencies.assistanceStore as LocalAssistanceAudioPublicationStore | undefined;
	if (!store || typeof store.beginSourceWrite !== 'function' || typeof store.deleteSource !== 'function') {
		throw new Error('Audio effect publication storage is unavailable.');
	}
	const token = dependencies.captureProject();
	const project = record(dependencies.getProject());
	const selectionFingerprint = fingerprint();
	const targets = localAssistanceAudioEffectTargets(project, dependencies.getSelectedClipId());
	if (!targets.length) throw new Error('Audio effects require a selected audio range or occurrence.');
	const originalSelection = project.selection == null ? {} : record(project.selection);
	const publishedIds = new Set<string>();
	const pending = new Set<Promise<unknown>>();
	const staged = new Map<number, StagedEdit>();
	let phase: 'open' | 'committed' | 'discarded' = 'open';
	let disposal: Promise<void> | null = null;

	function fingerprint(): string {
		return JSON.stringify({ selection: record(dependencies.getProject()).selection ?? null,
			focusedClipId: dependencies.getSelectedClipId() });
	}
	function assertCurrent(): void {
		if (phase !== 'open') throw new Error('The audio effect batch is no longer open.');
		dependencies.assertProject(token);
		if (fingerprint() !== selectionFingerprint) throw new AssistanceProposalStaleError();
	}
	function track<Value>(work: () => Promise<Value>): Promise<Value> {
		const operation = Promise.resolve().then(work);
		pending.add(operation);
		return operation.finally(() => { pending.delete(operation); });
	}
	const trackedStore = new Proxy(store, { get(target, key) {
		if (key === 'beginSourceWrite') return (id: string, metadata: DataRecord) => track(async () => {
			assertCurrent();
			const writer = await target.beginSourceWrite(id, metadata);
			try { assertCurrent(); }
			catch (error) { await writer.abort(error); throw error; }
			return Object.freeze({
				get framesWritten() { return writer.framesWritten; },
				write: (channels: readonly Float32Array[]) => track(async () => {
					assertCurrent(); await writer.write(channels); assertCurrent();
				}),
				commit: (value?: DataRecord, options?: Readonly<{ ifAbsent?: boolean }>) => track(async () => {
					assertCurrent();
					const result = await writer.commit(value, options);
					publishedIds.add(id); assertCurrent(); return result;
				}),
				abort: (reason?: unknown) => writer.abort(reason),
			} satisfies LocalAssistanceAudioSourceWriter);
		});
		if (key === 'deleteSource') return (id: string) => track(async () => {
			await target.deleteSource(id); publishedIds.delete(id);
		});
		const value: unknown = Reflect.get(target, key, target);
		return typeof value === 'function' ? value.bind(target) : value;
	} });
	const preparations = targets.map((target, index) => {
		const targetDependencies: DeferredLocalAssistanceRuntimeDependencies = { ...dependencies,
			getProject: () => { assertCurrent(); return { ...record(dependencies.getProject()), selection: target.selection }; },
			getSelectedClipId: () => { assertCurrent(); return target.clipId; },
			captureProject: () => { assertCurrent(); return token; },
			assertProject: () => { assertCurrent(); },
			assistanceStore: trackedStore,
			renderDryTrackRange: async (...args) => {
				assertCurrent(); const channels = await dependencies.renderDryTrackRange(...args);
				assertCurrent(); return channels;
			},
			commit: (command, selection) => {
				assertCurrent();
				if (staged.has(index)) throw new Error('An audio occurrence was already staged in this batch.');
				const commands = recordCommands(command);
				if (!selection || !commands.some(value => value.type === 'range/lift-delete'
					&& Array.isArray(value.clipIds) && value.clipIds.length === 1 && value.clipIds[0] === target.clipId)) {
					throw new Error('An audio effect batch requires exact selection replacement.');
				}
				if (commands.some(value => !['source/add', 'clip/unlink-av', 'range/lift-delete',
					'clip/add', 'track/add', 'selection/set'].includes(String(value.type)))) {
					throw new Error('An audio effect batch received an unrelated command.');
				}
				staged.set(index, Object.freeze({ commands: structuredClone(commands), selection }));
			},
		};
		resolveLocalAssistanceSelectedMediaAuthority(targetDependencies);
		const preparation = createPreparation(targetDependencies);
		return scopePreparation(preparation, workflowId, () => { assertCurrent(); });
	});

	async function dispose(): Promise<void> {
		if (phase === 'committed') return;
		if (disposal) return disposal;
		phase = 'discarded';
		disposal = (async () => {
			while (pending.size) await Promise.allSettled([...pending]);
			const failures: unknown[] = [];
			for (const id of publishedIds) {
				try { await store!.deleteSource(id); publishedIds.delete(id); }
				catch (error) { failures.push(error); }
			}
			staged.clear();
			if (failures.length) throw new AggregateError(failures, 'Audio effect batch cleanup failed.');
		})();
		return disposal;
	}
	return Object.freeze({ preparations: Object.freeze(preparations), dispose, async commit() {
		try {
			assertCurrent();
			if (pending.size || staged.size !== targets.length) throw new Error('The audio effect batch is incomplete.');
			const edits = targets.map((_target, index) => staged.get(index)!);
			const commands = edits.flatMap(edit => edit.commands.filter(value => value.type !== 'selection/set'));
			const sourceIds = commands.filter(value => value.type === 'source/add').map(value => String(record(value.source).id));
			if (sourceIds.some(id => !publishedIds.has(id))) throw new Error('Audio effect source custody is unavailable.');
			commands.push({ type: 'selection/set', startFrame: originalSelection.startFrame ?? 0,
				endFrame: originalSelection.endFrame ?? 0,
				trackIds: [...new Set(targets.map(target => target.trackId))],
				clipIds: edits.map(edit => edit.selection.selectClipId), frequencyRange: null });
			assertCurrent();
			dependencies.commit({ type: 'batch', commands }, edits[0]!.selection);
			phase = 'committed'; publishedIds.clear(); staged.clear();
		} catch (error) {
			try { await dispose(); }
			catch (cleanupError) { throw new AggregateError([error, cleanupError],
				'Audio effect publication and rollback failed.', { cause: cleanupError }); }
			throw error;
		}
	} });
}

function scopePreparation(
	preparation: LocalAssistanceSelectedMediaPreparationPort,
	workflowId: LocalAssistanceAudioEffectWorkflowId,
	assertCurrent: () => void,
): LocalAssistanceSelectedMediaPreparationPort {
	const operation = OPERATIONS[workflowId];
	const scoped: LocalAssistanceSelectedMediaPreparationPort = {
		listSelectedMedia: async () => { assertCurrent(); return preparation.listSelectedMedia(); },
		prepareSelectedMedia: async (request: Parameters<LocalAssistanceSelectedMediaPreparationPort['prepareSelectedMedia']>[0]) => {
			assertCurrent();
			if (request.operation !== operation) throw new Error('The batch belongs to another audio effect.');
			return preparation.prepareSelectedMedia(request);
		},
		prepareGuidedWorkflow: async (request: Parameters<NonNullable<LocalAssistanceSelectedMediaPreparationPort['prepareGuidedWorkflow']>>[0]) => {
			assertCurrent();
			if (request.workflowId !== workflowId) throw new Error('The batch belongs to another audio effect.');
			return preparation.prepareGuidedWorkflow!(request);
		},
		assertCurrentWorkflowFence: async (
			workflow: Parameters<NonNullable<LocalAssistanceSelectedMediaPreparationPort['assertCurrentWorkflowFence']>>[0],
			signal: AbortSignal,
		) => {
			assertCurrent(); await preparation.assertCurrentWorkflowFence!(workflow, signal); assertCurrent();
		},
		acceptGuidedWorkflowResult: async (request: Parameters<NonNullable<LocalAssistanceSelectedMediaPreparationPort['acceptGuidedWorkflowResult']>>[0]) => {
			assertCurrent();
			if (record(request.workflow).workflowId !== workflowId) throw new Error('The batch belongs to another audio effect.');
			return preparation.acceptGuidedWorkflowResult!(request);
		},
		acceptValidatedResult: async (request: Parameters<NonNullable<LocalAssistanceSelectedMediaPreparationPort['acceptValidatedResult']>>[0]) => {
			assertCurrent();
			if (request.operation !== operation) throw new Error('The batch belongs to another audio effect.');
			await preparation.acceptValidatedResult!(request);
		},
	};
	return Object.freeze(scoped);
}

function recordCommands(command: DataRecord): readonly DataRecord[] {
	if (command.type !== 'batch' || !Array.isArray(command.commands)) throw new Error('An audio effect requires an atomic command.');
	return command.commands.map(record);
}
function record(value: unknown): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Audio effect batching requires records.');
	return value as DataRecord;
}
