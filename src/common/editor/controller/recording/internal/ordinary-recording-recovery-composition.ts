/* SPDX-License-Identifier: AGPL-3.0-only */
import type { RecordingCompositionDependencies, RecordingCompositionProject } from './recording-composition-types.ts';
import type { RecordingRecoveryDestination } from '../../../storage/recording-recovery-journal-repository.ts';
import { RecordingRecoveryJournalRepository } from '../../../storage/recording-recovery-journal-repository.ts';
import { createOrdinaryRecordingRecoveryService, type OrdinaryRecordingPendingRecovery } from './ordinary-recording-recovery-service.ts';
import { ordinaryRecordingRecoveryPunches, ordinaryRecordingCheckpointsArePublished } from './ordinary-recording-recovery-project.ts';
import { prepareOrdinaryRecordingRecoveryTarget } from './ordinary-recording-recovery-target.ts';
import { validateOrdinaryRecordingRecoveryPrefix } from './ordinary-recording-recovery-prefix.ts';
import { setLocalizedStatus } from '../../../../i18n/presentation-message.ts';
import { createCoalescingSourceWriter } from '../../source/source-audio.ts';
import { createStableId } from '../../../project.js';
import { createTakeCycleCurrentProjectPublicationService } from './take-cycle/take-cycle-current-project-publication-service.ts';
import type { ProjectDocument } from '../../../storage/project-repository.ts';
import type { RecordingSourceWriter } from '../recording-transaction-types.ts';
import type { TakeCyclePendingOpenRecovery } from '../take-cycle-capture-orchestrator.ts';

/** Ordinary captures share the existing explicit open-recovery owner and document fences. */
export function createOrdinaryRecordingRecoveryComposition(dependencies: RecordingCompositionDependencies) {
	const { store, document, state } = dependencies;
	const publication = createTakeCycleCurrentProjectPublicationService({
		session: dependencies.session,
		getActiveProject: document.get, getActiveHistory: () => state.history,
		setActiveProject: document.set, setActiveHistory: (history) => { state.history = history; },
		isActiveProject: (projectId) => document.get()?.id === projectId,
		synchronizeProject: async (project) => {
			await dependencies.recordPersistedSnapshot?.(project);
			state.saveState = 'saved';
			dependencies.retention.retainLiveClipIds();
			await dependencies.applyProjectToPlaybackEngine(project);
			dependencies.publishProjectState();
		},
	});
	const load = (projectId: string): Promise<ProjectDocument | null> => store.loadProject
		? store.loadProject(projectId) : store.projectRepository!.load(projectId);
	let preparedLoss = 0;
	const service = store.analysisRepository && store.projectRepository ? createOrdinaryRecordingRecoveryService({
		repository: new RecordingRecoveryJournalRepository(store.analysisRepository),
		getProjectId: () => document.get()?.id ?? null,
		assertWritable: () => {
			if (state.disposed || state.readOnly || !document.get() || state.projectLock?.readOnly) throw new Error('Interrupted recording requires a writable active project.');
		},
		loadProject: load,
		prepareTarget: async (base, journal) => {
			dependencies.projectRuntime.cloneProject(base);
			if (!store.sourceRepository) throw new Error('Recording recovery source storage is unavailable.');
			const validated = await validateOrdinaryRecordingRecoveryPrefix(journal, store.sourceRepository);
			preparedLoss = validated.lostCheckpointCount;
			const target = prepareOrdinaryRecordingRecoveryTarget(base as RecordingCompositionProject, validated.journal,
				dependencies.projectRuntime.applyCommand, new Date(dependencies.currentTimeMs()).toISOString(),
				dependencies.copy.ordinaryRecoveryTrack ?? dependencies.copy.recording);
			const punches = ordinaryRecordingRecoveryPunches(target as RecordingCompositionProject, {
				...validated.journal, lanes: validated.journal.lanes.map((lane) => ({ ...lane, destination: { ...lane.destination,
					trackId: target.tracks.some((track) => track.id === lane.destination.trackId && track.locked !== true && track.type === 'audio')
						? lane.destination.trackId : `${journal.id}-${lane.id}-recovered-track` } })),
			});
			for (const { source } of punches) {
				const metadata = await store.sourceRepository?.getMetadata(source.id);
				if (!metadata || metadata.frameCount !== source.frameCount || metadata.sampleRate !== source.sampleRate) throw new Error('A saved recording checkpoint is missing or changed.');
				await dependencies.activateStoredSource(source, metadata);
			}
			return target;
		},
		getPreparedLoss: () => preparedLoss,
		saveIfCurrent: async (base, target) => {
			const fenced = store.saveProjectIfCurrentWithWriteFence;
			if (fenced) {
				const writeFence = dependencies.getProjectWriteFence?.(base.id);
				if (!writeFence) throw new Error('Recording recovery has no current project write authority.');
				return fenced.call(store, base, target, writeFence);
			}
			const save = store.projectRepository!.saveIfCurrent;
			if (!save) throw new Error('Recording recovery requires exact project publication.');
			return save.call(store.projectRepository, base, target);
		},
		publish: async (base, target, journal) => {
			await assertDurableWriteAuthority(target);
			await publication.publish({ reason: 'recovery', base: base as RecordingCompositionProject,
				target: target as RecordingCompositionProject, command: null });
			if (journal.lostCheckpointCount) setLocalizedStatus(dependencies.setStatus, dependencies.copy,
				'ordinaryRecoveryRecoveredWithLoss', { count: journal.lostCheckpointCount }, 'info');
		},
		restoreProject: async (target) => {
			await assertDurableWriteAuthority(target);
			const active = document.get();
			if (!active || active.id !== target.id) throw new Error('Recording discard lost its active project.');
			await publication.publish({ reason: 'recovery', base: active,
				target: target as RecordingCompositionProject, command: null });
		},
		isPublished: ordinaryRecordingCheckpointsArePublished,
		isComplete: (project, journal) => {
			const required = new Set(ordinaryRecordingRecoveryPunches(project as RecordingCompositionProject, journal).map(({ source }) => source.id));
			return ordinaryRecordingCheckpointsArePublished(project, { ...journal,
				lanes: journal.lanes.map((lane) => ({ ...lane, segments: lane.segments.filter(({ sourceId }) => required.has(sourceId)) })) });
		},
		deleteSource: (sourceId) => store.deleteSource(sourceId),
	}) : null;
	async function assertDurableWriteAuthority(target: ProjectDocument): Promise<void> {
		const fenced = store.saveProjectIfCurrentWithWriteFence;
		if (!fenced) return;
		const writeFence = dependencies.getProjectWriteFence?.(target.id);
		if (!writeFence || !await fenced.call(store, target, target, writeFence)) throw new Error('Recording recovery lost current project write authority.');
	}

	let captureJournalEnabled = false;
	const enabled = () => document.get()?.schemaFamily === 'soundscaper';
	return Object.freeze({
		async begin() {
			captureJournalEnabled = Boolean(service && enabled());
			if (!captureJournalEnabled || !service) return;
			await dependencies.flushProject({ forceCurrentSnapshot: true });
			await service.begin(createStableId('recording-recovery'));
		},
		async openWriter(sourceId: string, metadata: Readonly<Record<string, unknown>>, destination?: RecordingRecoveryDestination): Promise<RecordingSourceWriter> {
			if (service && captureJournalEnabled && destination) await service.addLane(sourceId, destination);
			const { createRecordingCheckpointWriter } = await import('./recording-checkpoint-writer.ts');
			return createRecordingCheckpointWriter({ firstSourceId: sourceId,
				initialWriter: createCoalescingSourceWriter(await store.beginSourceWrite(sourceId, metadata)),
				metadata, checkpointFrames: Math.round(Number(metadata.sampleRate) * 10),
				createSourceId: () => createStableId('recording'),
				openWriter: async (id) => createCoalescingSourceWriter(await store.beginSourceWrite(id, metadata)),
				...(service && captureJournalEnabled && destination ? { onCheckpoint: (segment) => service.checkpoint(sourceId, segment) } : {}),
			});
		},
		async complete() {
			if (!service || !captureJournalEnabled) return;
			try { await dependencies.flushProject({ forceCurrentSnapshot: true }); await service.complete(); }
			catch (error) { state.takeCycleRecovery = await service.inspect(document.get()?.id ?? ''); dependencies.publishDocumentSnapshot(); throw error; }
		},
		async deleteCapturedSource(sourceId: string) {
			if (service && captureJournalEnabled) await service.deleteCapturedSource(sourceId);
			else await store.deleteSource(sourceId);
		},
		async prepareDiscard() { if (captureJournalEnabled) await service?.prepareDiscard(); },
		async abandon() { if (captureJournalEnabled) await service?.abandon(); },
		async inspect(projectId: string) { return enabled() ? await service?.inspect(projectId) ?? null : null; },
		async resolve(pending: TakeCyclePendingOpenRecovery, decision: 'recover' | 'discard') {
			if (!service || pending.kind !== 'recording-pending-open-recovery' || pending.checkpointCount === undefined) throw new Error('Ordinary recording recovery is unavailable.');
			await service.resolve(pending as OrdinaryRecordingPendingRecovery, decision);
		},
	});
}
