/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_PROJECT_TASK_SCOPE, type EditorLifetimeToken } from '../shared/lifecycle.ts'; import { publishedCopyFor } from '../shared/presentation-localization.ts'; import { setLocalizedStatus } from '../../../i18n/presentation-message.ts'; import { publishProjectReadOnlyStatus } from './project-read-only-status.ts'; import { createProjectActivationEditFence } from './project-activation-edit-fence.ts';
import { inputId, isActiveProjectSwitchInput, prepareProjectSwitchHistory, projectSwitchPlayhead } from './internal/project/project-switch-input.ts'; import { verifyProjectSwitchStorageCurrent } from './internal/project/project-switch-storage-currentness.ts'; import { resetDesktopOriginal } from '../../desktop-overwrite-original.ts';
import { createPlaybackProjectService } from '../source/playback-project-service.ts';
import { beginProjectSwitchInspectionFence, projectSwitchCleanupError } from './internal/project/project-switch-inspection-fence.ts';
import type { ProjectLifecycleHistory, ProjectLifecycleLock, ProjectLifecycleProject } from './project-lifecycle-types.ts';
import type {
	NewProjectOptions,
	ProjectSwitchOptions,
	ProjectSwitchServiceRuntime,
} from './project-switch-service-types.ts';
import type { SourceChunkProviderReplacement } from '../source/source-chunk-provider-registry.ts';
import { createImmediateTakeCycleOpenRecoveryProjectPort } from '../recording/take-cycle-open-recovery-app-port.ts';

export type {
	NewProjectOptions,
	ProjectFallbackIntegrityAdmission,
	ProjectSwitchGuard,
	ProjectSwitchLifetime,
	ProjectSwitchOptions,
	ProjectSwitchServiceRuntime,
	ProjectSwitchSession,
	ProjectSwitchState,
} from './project-switch-service-types.ts';
const NO_PROJECT_SWITCH_FAILURE = Symbol('no-project-switch-failure');

/**
 * Serializes project activation and rejects all post-await work after terminal
 * disposal. Project-scoped tasks are invalidated before any flush or I/O begins.
 */
export function createProjectSwitchService<
	Project extends ProjectLifecycleProject,
	History extends ProjectLifecycleHistory<Project>,
	Buffer = unknown,
	Input = Project,
>(runtime: ProjectSwitchServiceRuntime<Project, History, Buffer, Input>) {
	const playbackProjects = runtime.playbackProjectService
		?? createPlaybackProjectService(runtime.productCapabilities), openRecovery = runtime.openRecovery ?? createImmediateTakeCycleOpenRecoveryProjectPort();
	const activationEditFence = createProjectActivationEditFence(runtime.state, runtime.publishDocumentSnapshot);
	const beginScapeInspectionFence = (preserveOpenRequest = false) =>
		beginProjectSwitchInspectionFence(runtime.scapeInspectionQuiescence, runtime.lifetime, preserveOpenRequest);
	let readyProjectId = runtime.getProject()?.id ?? null;
	return Object.freeze({
		newProject,
		openProject,
		performProjectSwitch,
		switchProject,
	});

	async function newProject(options: NewProjectOptions = {}): Promise<string> {
		const title = String(options.title || publishedCopyFor(runtime.copy).untitledProject).trim() || publishedCopyFor(runtime.copy).untitledProject;
		const sampleRate = runtime.normalizeProjectSampleRate(options.sampleRate);
		const trackCommand = runtime.createInitialAudioTrackCommand({
			type: 'audio',
			name: `${publishedCopyFor(runtime.copy).track} 1`,
			armed: true,
			height: 300,
		}, sampleRate);
		const nextProject = runtime.createProject({ title, sampleRate, tracks: [trackCommand.track] });
		await switchProject(nextProject, { save: true, skipFlush: options.skipFlush });
		if (runtime.getProject()?.id === nextProject.id) runtime.assignPreferredInputToTrack(trackCommand.track.id);
		return nextProject.id;
	}

	async function openProject(value: unknown, isCurrent: () => boolean = () => true): Promise<void> {
		const loaded = runtime.loadProject(value);
		const readOnly = Boolean(loaded.readOnly || loaded.intrinsicReadOnly);
		const readOnlyReason = !readOnly
			? null
			: loaded.reason === 'proxy-attached'
				? runtime.copy.projectReadOnly
				: runtime.copy.futureProjectReadOnly;
		const id = inputId(loaded.project);
		const save = !readOnly && id !== null && Boolean(runtime.createProjectIfAbsent && await runtime.isProjectAbsent?.(id));
		if (!isCurrent()) return;
		await switchProject(loaded.project, { readOnly, readOnlyReason, save });
	}

	function switchProject(
		nextProject: Project | Input,
		options: ProjectSwitchOptions<History> = {},
	): Promise<void> {
		if (runtime.state.projectAdministrationPending && !options.skipFlush) return Promise.reject(new DOMException('Local data reset is pending.', 'AbortError'));
		const token = runtime.lifetime.capture();
		if (options.adoptSessionRevision !== true
			&& activationEditFence.pending === 0 && isActiveProjectSwitchInput(nextProject, readyProjectId, runtime.getProject()?.id)) {
			runtime.lifetime.assertActive(token);
			return Promise.resolve();
		}
		return activationEditFence.enqueue(
			() => beginScapeInspectionFence(options.preserveScapeOpenRequest === true),
			async (fence) => {
				runtime.lifetime.assertActive(token);
				await fence.wait();
				runtime.lifetime.assertActive(token);
				await performProjectSwitchUnderFence(nextProject, options, token);
			},
		);
	}

	async function performProjectSwitch(
		nextProject: Project | Input,
		options: ProjectSwitchOptions<History> = {},
		token: EditorLifetimeToken = runtime.lifetime.capture(),
	): Promise<void> {
		runtime.lifetime.assertActive(token);
		if (options.adoptSessionRevision !== true
			&& activationEditFence.pending === 0 && isActiveProjectSwitchInput(nextProject, readyProjectId, runtime.getProject()?.id)) return;
		await activationEditFence.enqueue(beginScapeInspectionFence, async (fence) => {
			await fence.wait();
			runtime.lifetime.assertActive(token);
			await performProjectSwitchUnderFence(nextProject, options, token);
		});
	}

	async function performProjectSwitchUnderFence(
		nextProject: Project | Input,
		options: ProjectSwitchOptions<History>,
		token: EditorLifetimeToken,
	): Promise<void> {
		if (options.adoptSessionRevision !== true
			&& isActiveProjectSwitchInput(nextProject, readyProjectId, runtime.getProject()?.id)) return;
		const guard = <Value>(value: PromiseLike<Value> | Value) => runtime.lifetime.guard(value, token);
		if (options.replaceSessionHistory && options.adoptSessionRevision !== true) {
			throw new TypeError('Replacing an open session history requires explicit revision adoption.');
		}
		const { projectId, existingCapture, activationHistory, activationProject } = prepareProjectSwitchHistory(
			nextProject, options.history, runtime.createHistory,
			(id) => runtime.sessionTab(id) ? runtime.session.captureProjectHistory(id) : null,
			options.replaceSessionHistory === true,
		);
		const fallbackAdmission = await guard(runtime.verifyProjectFallbackIntegrity(activationProject, {
			signal: runtime.lifetime.signal,
		}));
		fallbackAdmission.assertCurrent(activationProject);
		if (playbackProjects.prepareProjectForActivation) {
			await guard(playbackProjects.prepareProjectForActivation(activationProject, {
				signal: runtime.lifetime.signal,
			}));
			fallbackAdmission.assertCurrent(activationProject);
		}
		const playbackAdmission = playbackProjects.projectForActivationAdmission
			? playbackProjects.projectForActivationAdmission(activationProject)
			: playbackProjects.projectForPlayback(activationProject);
		let playbackProjection = playbackAdmission;
		const preparedFallbackSources = playbackAdmission.requiredAudioSourceIds.length
			? await guard(runtime.prepareRequiredProjectSources(activationProject, {
				requiredAudioSourceIds: playbackAdmission.requiredAudioSourceIds,
				signal: runtime.lifetime.signal,
			}))
			: null;
		let activation: ReturnType<typeof runtime.session.beginProjectActivation>;
		try {
			fallbackAdmission.assertCurrent(activationProject);
			activation = runtime.session.beginProjectActivation(projectId, existingCapture
				? { expectedHistoryToken: existingCapture.token }
				: { requireAbsent: true });
		} catch (error) {
			try {
				await preparedFallbackSources?.discard();
			} catch (cleanupError) {
				throw projectSwitchCleanupError(
					error,
					cleanupError,
					'Project activation reservation and prepared-source cleanup both failed.',
				);
			}
			throw error;
		}
		const featureRequirementsReport = playbackAdmission.featureRequirementsReport;
		const featureRequirementsReadOnly = Boolean(featureRequirementsReport && !featureRequirementsReport.compatible);
		let providerReplacement: SourceChunkProviderReplacement | null = null;
		let providerReplacementFinalized = false;
		let playbackActivationComplete = false;
		let initialPublicationConflict = false;
		// The session call's successful return is the activation authority boundary.
		let targetSessionActivated = false;
		let activeLock: ProjectLifecycleLock | null = null, switchFailure: unknown | typeof NO_PROJECT_SWITCH_FAILURE = NO_PROJECT_SWITCH_FAILURE;
		let stagedLock: ProjectLifecycleLock | null = null;
		const previousProject = runtime.getProject();
		const existingMetadata = existingCapture ? runtime.sessionTab(projectId)?.metadata || {} : {};
		const transient = existingMetadata.transient === true || options.transient === true;
		const leavingReadOnly = previousProject !== null && previousProject.id !== projectId && runtime.state.readOnly;
		try {
			// Cancellation is a registry query, not an inventory: everything the
			// open project owns carries the project scope, so a subsystem joins
			// this teardown by tagging its task rather than by being listed here.
			runtime.lifetime.cancelScope(EDITOR_PROJECT_TASK_SCOPE);
			runtime.projectGeneration.invalidate();
			runtime.effectsState.beginSwitch();
			runtime.state.videoEffectGestures.clear();
			runtime.cancelTimedRecording({ publish: false, status: false });
			runtime.cancelRecordingStart();
			runtime.state.exportAbort = null;
			runtime.state.sampleEditAbort = null;
			runtime.state.sampleEditMode = null;
			runtime.state.sampleEditAvailable = false;
			runtime.cancelPlaybackCachePreparation();
			runtime.cancelPlayAtSpeedPreparation();
			await guard(runtime.stopRecording().catch(() => undefined));
			runtime.persistActiveSessionUiState();
			if (!options.skipFlush && previousProject && previousProject.id !== projectId && !runtime.state.readOnly && !openRecovery.blocked) {
				await guard(runtime.saveNow());
			}
			const previousLock = runtime.state.projectLock;
			let stale = !transient && Boolean(existingCapture && previousProject?.id !== projectId && options.adoptSessionRevision !== true
				&& runtime.isPersistedSnapshotCurrent && !await guard(runtime.isPersistedSnapshotCurrent(projectId)));
			if (transient) stagedLock = { projectId, readOnly: true, method: 'opaque-archive', release() {} };
			else if (!stale && (!previousLock || previousLock.projectId !== projectId || previousLock.readOnly)) {
				stagedLock = await runtime.acquireProjectLock(projectId, { force: true });
				runtime.lifetime.assertActive(token);
			}
			const acquiredLock = stagedLock ?? previousLock;
			stale ||= Boolean(acquiredLock && !acquiredLock.readOnly && !await guard(verifyProjectSwitchStorageCurrent(
				runtime, projectId, activationProject, Boolean(existingCapture), options,
			)));
			if (stale) {
				if (stagedLock) await guard(discardLock(stagedLock));
				stagedLock = { projectId, readOnly: true, method: 'stale-project', release() {} };
			}
			const activationLock = stagedLock ?? previousLock;
			if (!activationLock) throw new Error('Project activation requires an acquired project lock.');
			runtime.cancelScheduledSave();
			readyProjectId = null;
			runtime.stopEngine();
			await guard(runtime.stopProjectBinPreview({ dispose: true }));
			await guard(runtime.disposeRenderEngines());
			providerReplacement = runtime.beginSourceChunkProviderReplacement();
			runtime.cancelEffectPreview({ publish: false });
			if (stagedLock) {
				await guard(runtime.releaseProjectLock());
				runtime.state.projectLock = stagedLock;
				stagedLock = null;
			}
			activeLock = activationLock;
			const lockReadOnly = activationLock.readOnly && !transient;
			const retainStoredReadOnly = existingCapture != null || options.readOnly == null;
			const declaredReadOnly = transient || (retainStoredReadOnly
				? Boolean(existingMetadata.declaredReadOnly ?? (
					existingMetadata.featureRequirementsReadOnly ? false : existingMetadata.intrinsicReadOnly
				))
				: Boolean(options.readOnly));
			const declaredReadOnlyReason = declaredReadOnly
				? retainStoredReadOnly
					? existingMetadata.declaredReadOnlyReason ?? existingMetadata.intrinsicReadOnlyReason ?? null
					: options.readOnlyReason ?? null
				: null;
			const intrinsicReadOnly = Boolean(declaredReadOnly || featureRequirementsReadOnly);
			const intrinsicReadOnlyReason = declaredReadOnlyReason
				?? (featureRequirementsReadOnly ? runtime.copy.projectReadOnly : null);
			runtime.state.readOnly = Boolean(intrinsicReadOnly || lockReadOnly);
			const featureMetadata = {
				declaredReadOnly, declaredReadOnlyReason, intrinsicReadOnly, intrinsicReadOnlyReason, transient,
				featureRequirementsReadOnly, featureRequirementsReport,
				featureRequirementsAudioEffectPlaybackBypass: playbackAdmission.audioEffectPlaybackBypass,
				featureRequirementsAudioRenderedFallback: playbackAdmission.audioRenderedFallback,
				featureRequirementsVideoEffectPlaybackBypass: playbackAdmission.videoEffectPlaybackBypass,
				featureRequirementsVideoRenderedFallback: playbackAdmission.videoRenderedFallback,
			};
			if (existingCapture) {
				runtime.session.switchProject(projectId, { activationToken: activation.token });
				targetSessionActivated = true;
				if (options.replaceSessionHistory) {
					if (!runtime.session.installCommittedProjectHistory) throw new Error('Session history installation is unavailable.');
					runtime.session.installCommittedProjectHistory(projectId, activationHistory, {
						activationToken: activation.token, expectedHistoryToken: existingCapture.token,
						readOnly: runtime.state.readOnly, dirty: false,
					});
				}
			} else runtime.session.openProject(activationProject, {
				activationToken: activation.token,
				history: activationHistory, dirty: Boolean(options.save && !runtime.state.readOnly),
				readOnly: runtime.state.readOnly,
				readOnlyReason: lockReadOnly ? 'project-lock' : intrinsicReadOnlyReason,
				lockMethod: activationLock.method,
				metadata: featureMetadata,
			});
			targetSessionActivated = true;
			runtime.session.updateProjectMetadata(projectId, featureMetadata);
			runtime.session.setProjectReadOnly(projectId, {
				readOnly: runtime.state.readOnly,
				reason: lockReadOnly ? 'project-lock' : intrinsicReadOnlyReason,
				lockMethod: activationLock.method,
			});
			runtime.state.history = runtime.session.getProjectHistory(projectId);
			runtime.state.saveState = runtime.sessionTab(projectId)?.dirty ? 'dirty' : 'saved';
			const activeProject = runtime.state.history.present;
			fallbackAdmission.assertCurrent(activeProject);
			resetProjectScopedState();
			runtime.setProject(activeProject);
			runtime.watchProjectLockLoss(projectId, activationLock);
			runtime.projectGeneration.activate(activeProject.id);
			await guard(openRecovery.inspectOpenedProject(projectId));
			await guard(runtime.loadRecordingRouting(activeProject));
			const tabMetadata = runtime.sessionTab(projectId)?.metadata || {};
			runtime.restoreProjectSelection(activeProject, tabMetadata);
			runtime.state.clipboard = runtime.session.clipboardForProject(projectId)?.descriptor ?? null;
			const outputUrl = runtime.state.outputUrl;
			runtime.state.outputUrl = null;
			if (outputUrl) runtime.revokeOutputUrl(outputUrl);
			const outputCleanup = runtime.state.outputCleanup;
			runtime.state.outputCleanup = null;
			await guard(outputCleanup?.());
			runtime.state.exportOutput = null;
			runtime.state.missingSourceIds.clear();
			await guard(runtime.revokeVideoVisuals());
			runtime.clearWaveformPcmWindows();
			const loadedSourceBuffers = await guard(runtime.loadProjectSources(activeProject, {
				excludedAudioSourceIds: playbackAdmission.requiredAudioSourceIds,
				requiredVideoSourceIds: playbackAdmission.requiredVideoSourceIds,
				signal: runtime.lifetime.signal,
			}));
			if (playbackProjects.projectForActivationAdmission) {
				playbackProjection = playbackProjects.projectForPlayback(activeProject);
			}
			runtime.retainLiveClipIds();
			runtime.evictUnreferencedSourceCaches();
			fallbackAdmission.assertCurrent(activeProject);
			const position = projectSwitchPlayhead(activeProject.view, tabMetadata.playheadFrame);
			if (preparedFallbackSources) {
				await guard(preparedFallbackSources.commit(
					(preparedSources) => runtime.loadEngineProject(
						playbackProjection.project, undefined, preparedSources, position,
					),
					{
						assertCurrent: () => fallbackAdmission.assertCurrent(activeProject),
						retireApplied: () => runtime.stopEngine(),
						transientBuffers: loadedSourceBuffers,
					},
				));
			} else await guard(runtime.loadEngineProject(playbackProjection.project, loadedSourceBuffers, undefined, position));
			providerReplacementFinalized = true;
			await providerReplacement.commit();
			runtime.lifetime.assertActive(token);
			fallbackAdmission.assertCurrent(activeProject);
			if (!transient) await guard(openRecovery.deferRecordOpened(() => runtime.recordOpenedProject(projectId, guard)));
			playbackActivationComplete = true;
			if (options.save && !runtime.state.readOnly) {
				await guard(openRecovery.deferInitialSave(async () => {
					const currentProject = runtime.getProject();
					if (!currentProject || currentProject.id !== projectId) throw new Error('Deferred project save belongs to a stale project.');
					if (runtime.createProjectIfAbsent) {
						const created = await guard(runtime.createProjectIfAbsent(currentProject, { signal: AbortSignal.any([runtime.lifetime.signal]), assertCurrent: () => { runtime.lifetime.assertActive(token); if (runtime.getProject()?.id !== projectId) throw new DOMException('The project changed before initial publication.', 'AbortError'); } }));
						if (created === null) { initialPublicationConflict = true; throw new Error('The project already exists at create-only publication.'); }
					} else await guard(runtime.saveProject(currentProject));
					runtime.session.markProjectSaved(projectId);
				}));
			}
			if (!transient && (!existingCapture || options.adoptSessionRevision === true && !lockReadOnly)) await guard(runtime.recordPersistedSnapshot?.(activeProject));
			runtime.state.saveState = runtime.sessionTab(activeProject.id)?.dirty ? 'dirty' : 'saved';
			runtime.state.projects = Object.freeze(await guard(runtime.listProjects()));
			runtime.synchronizeMicrophoneMeterTarget();
			runtime.publishProjectState();
			readyProjectId = activeProject.id;
			if (!runtime.state.readOnly) {
				await guard(openRecovery.deferGarbageCollection(() => runtime.garbageCollectSources()));
			}
			if (!options.save && !runtime.state.readOnly) {
				const isCurrentWritable = (): boolean => {
					try { runtime.lifetime.assertActive(token); }
					catch { return false; }
					return runtime.getProject()?.id === projectId
						&& runtime.state.projectLock === activationLock
						&& !runtime.state.readOnly && !activationLock.readOnly;
				};
				await guard(openRecovery.deferMaintenance(async () => { try { await runtime.maintainOpenedProject(projectId, isCurrentWritable); } catch { /* Report-only. */ } }));
				runtime.lifetime.assertActive(token);
			}
			if (lockReadOnly) setLocalizedStatus(runtime.setStatus, runtime.copy, stale ? 'projectReadOnly' : 'projectOpenOtherTab', undefined, 'error');
			else if (runtime.state.readOnly) {
				publishProjectReadOnlyStatus(runtime.copy, runtime.setStatus, intrinsicReadOnlyReason);
			} else if (leavingReadOnly && !openRecovery.blocked) setLocalizedStatus(runtime.setStatus, runtime.copy, 'ready', undefined, 'success');
			if (!stale && !transient) runtime.scheduleProjectLockRecovery(projectId, activationLock);
		} catch (error) {
			let failure = error;
			const cleanup = async (
				operation: () => PromiseLike<unknown> | unknown,
				message: string,
			): Promise<boolean> => {
				try {
					await operation();
					return true;
				} catch (cleanupError) {
					failure = projectSwitchCleanupError(failure, cleanupError, message);
					return false;
				}
			};
			const failedTarget = targetSessionActivated && (!playbackActivationComplete || initialPublicationConflict) && readyProjectId !== projectId;
			const lifetimeDisposed = () => runtime.isDisposedError(error)
				|| runtime.lifetime.signal.aborted;
			const canPublishFailedTarget = () => failedTarget && !lifetimeDisposed();
			const abandonedLock = stagedLock;
			if (abandonedLock) await cleanup(() => discardLock(abandonedLock), 'Project switching and staged-lock release both failed.');
			const targetLock = failedTarget
				? runtime.state.projectLock?.projectId === projectId
					? runtime.state.projectLock : activeLock
				: null;
			if (canPublishFailedTarget()) {
				await cleanup(() => {
					if (runtime.state.history?.present.id !== projectId) runtime.state.history = activationHistory;
					const failedProject = runtime.state.history.present;
					if (runtime.getProject()?.id !== projectId) runtime.setProject(failedProject);
					runtime.projectGeneration.activate(projectId);
					const tabMetadata = runtime.sessionTab(projectId)?.metadata || {};
					runtime.restoreProjectSelection(failedProject, tabMetadata);
					runtime.state.clipboard = runtime.session.clipboardForProject(projectId)?.descriptor ?? null;
					resetProjectScopedState();
					runtime.state.missingSourceIds.clear();
				}, 'Project switching and failed-target state alignment both failed.');
			}
			if (canPublishFailedTarget()) {
				runtime.state.readOnly = true;
				await cleanup(() => runtime.session.setProjectReadOnly(projectId, {
					readOnly: true,
					reason: 'project-activation-failed',
					lockMethod: targetLock?.method ?? 'unavailable',
				}), 'Project switching and failed-target write fencing both failed.');
			}
			if ((providerReplacement && !providerReplacementFinalized) || canPublishFailedTarget()) {
				await cleanup(
					() => runtime.stopEngine(),
					'Project switching and staged-engine shutdown both failed.',
				);
			}
			const failedProviderReplacement = providerReplacement;
			if (failedProviderReplacement && !providerReplacementFinalized) {
				// Restoring prior-project providers after session activation would cross project ownership.
				await cleanup(
					() => targetSessionActivated
						? failedProviderReplacement.commit() : failedProviderReplacement.rollback(),
					targetSessionActivated
						? 'Project switching and incoming source-provider finalization both failed.'
						: 'Project switching and source-provider rollback both failed.',
				);
			}
			if (canPublishFailedTarget()) {
				const failedOutputUrl = runtime.state.outputUrl;
				runtime.state.outputUrl = null;
				runtime.state.exportOutput = null;
				if (failedOutputUrl) await cleanup(
					() => runtime.revokeOutputUrl(failedOutputUrl),
					'Project switching and output URL cleanup both failed.',
				);
			}
			if (canPublishFailedTarget()) {
				const failedOutputCleanup = runtime.state.outputCleanup;
				runtime.state.outputCleanup = null;
				if (failedOutputCleanup) await cleanup(
					failedOutputCleanup,
					'Project switching and export output cleanup both failed.',
				);
			}
			if (canPublishFailedTarget()) {
				await cleanup(() => {
					runtime.clearWaveformPcmWindows();
					runtime.retainLiveClipIds();
					runtime.evictUnreferencedSourceCaches();
				}, 'Project switching and source-cache alignment both failed.');
			}
			if (canPublishFailedTarget()) {
				await cleanup(
					() => runtime.revokeVideoVisuals(),
					'Project switching and video visual cleanup both failed.',
				);
			}
			if (canPublishFailedTarget()) {
				runtime.state.saveState = runtime.sessionTab(projectId)?.dirty ? 'dirty' : 'saved';
			}
			if (canPublishFailedTarget()) {
				await cleanup(() => runtime.synchronizeMicrophoneMeterTarget(),
					'Project switching and microphone routing synchronization both failed.');
			}
			if (canPublishFailedTarget() && targetLock) {
				await cleanup(() => runtime.scheduleProjectLockRecovery(projectId, targetLock),
					'Project switching and lock recovery scheduling both failed.');
			}
			if (canPublishFailedTarget()) {
				await cleanup(() => runtime.publishProjectState(),
					'Project switching and failed-target publication both failed.');
			}
			if (initialPublicationConflict) await cleanup(() => runtime.releaseProjectLock(), 'Failed to release lock after create-only collision.');
			if (lifetimeDisposed()) {
				await runtime.releaseProjectLock().catch(() => undefined);
				try {
					await runtime.clearSourceCaches();
				} catch (cleanupError) {
					failure = projectSwitchCleanupError(
						failure,
						cleanupError,
						'Project switching and source-cache cleanup both failed.',
					);
				}
				runtime.clearWaveformPcmWindows();
				try {
					await runtime.revokeVideoVisuals();
				} catch (cleanupError) {
					failure = projectSwitchCleanupError(
						failure,
						cleanupError,
						'Project switching and video visual cleanup both failed.',
					);
				}
			}
			if (!targetSessionActivated && !lifetimeDisposed() && previousProject && previousProject.id === runtime.getProject()?.id) await cleanup(() => runtime.projectGeneration.activate(previousProject.id), 'Project switching and origin ownership restoration both failed.');
			switchFailure = failure;
			throw failure;
		} finally {
			let cleanupFailure: unknown | typeof NO_PROJECT_SWITCH_FAILURE = NO_PROJECT_SWITCH_FAILURE;
			try {
				await preparedFallbackSources?.discard();
			} catch (error) {
				cleanupFailure = error;
			} finally {
				activation.release();
			}
			if (cleanupFailure !== NO_PROJECT_SWITCH_FAILURE) {
				if (switchFailure !== NO_PROJECT_SWITCH_FAILURE) {
					throw projectSwitchCleanupError(
						switchFailure,
						cleanupFailure,
						'Project switching and prepared-source cleanup both failed.',
					);
				}
				throw cleanupFailure;
			}
		}
	}

	function resetProjectScopedState(): void {
		resetDesktopOriginal(runtime.state);
		runtime.effectsState.resetScope();
		runtime.state.analysisResult = null;
		runtime.state.analysisVisuals = null;
		runtime.state.analysisReport = null;
		runtime.state.analysisProcessing = false;
		runtime.state.contrastSelections = { foreground: null, background: null };
	}
	async function discardLock(lock: ProjectLifecycleLock): Promise<void> {
		lock.release();
		await Promise.resolve(lock.finished).catch(() => undefined);
	}
}
