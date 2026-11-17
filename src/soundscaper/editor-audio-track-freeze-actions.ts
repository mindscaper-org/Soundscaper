/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createAudioTrackFreezeCoordinatorV21,
	type AudioTrackFreezeCoordinatorCommandV21,
} from '../common/editor/audio-track-freeze-coordinator-v21.ts';
import {
	assertCurrentSoundscaperFreezeProject,
	captureSoundscaperFreezeProject, type SoundscaperFreezeCurrencyController, type SoundscaperFreezeTicket,
} from './editor-audio-track-freeze-currency.ts';
import { createAudioEditorEngine } from '../common/editor/engine/runtime-class.ts';
import { createAudioClip } from '../common/editor/project-media-factory.ts';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { validateSoundscaperProject, type SoundscaperProject } from './editor-project-validation.ts';
import {
	hashFreezeBody, planFreezeRange, renderFreezeBody, stageFreezeSource,
	type FreezeBody, type FreezeStage, type FreezeStore, type FreezeTimePitchRenderOptions,
	type SoundscaperAudioFreezeRenderEngine,
} from './editor-audio-track-freeze-render.ts';
import {
	dataRecord, exactRecordById, nonNegativeInteger, positiveInteger,
	stableId, throwIfAborted, type DataRecord,
} from './editor-audio-track-freeze-values.ts';
export type { SoundscaperAudioFreezeRenderEngine } from './editor-audio-track-freeze-render.ts';
import { EditorProjectChangedError } from '../common/editor/controller/shared/lifecycle.ts';
import { assertSoundscaperFreezeHasNoSidechain } from './editor-audio-track-freeze-sidechain.ts';
import type {
	SoundscaperAudioTrackFreezePlaybackService,
	SoundscaperAudioTrackFreezeStatus,
} from './editor-audio-track-freeze-playback.ts';

export interface SoundscaperAudioFreezeEnvironment {
	readonly store: FreezeStore;
	readonly playback: SoundscaperAudioTrackFreezePlaybackService;
}

export interface SoundscaperAudioFreezeController extends SoundscaperFreezeCurrencyController {
	readonly actions: Readonly<{
		readonly edit: Readonly<{
			readonly commit: (command: AudioTrackFreezeCoordinatorCommandV21) => unknown;
		}>;
	}>;
}

export interface SoundscaperAudioFreezeActions {
	readonly freeze: (trackId: string) => Promise<unknown>;
	readonly refresh: (trackId: string) => Promise<unknown>;
	readonly unfreeze: (trackId: string) => Promise<unknown>;
	readonly commit: (trackId: string) => Promise<unknown>;
	readonly getStatus: (trackId: string) => SoundscaperAudioTrackFreezeStatus | 'verifying';
}

export interface SoundscaperAudioFreezeActionBinding {
	readonly actions: Readonly<SoundscaperAudioFreezeActions>;
	readonly dispose: () => Promise<void>;
}

export interface SoundscaperAudioFreezeActionsOptions extends FreezeTimePitchRenderOptions {
	/**
	 * The document validator for the revision these actions serve. Later
	 * production revisions inherit this file unchanged, so the revision is a
	 * parameter rather than something the file names.
	 */
	readonly validateProject?: (project: unknown) => unknown;
	/** Lower-only deterministic test seam. */
	readonly createId?: (kind: 'source' | 'clip') => string;
	/** Lower-only renderer test seam. */
	readonly createRenderEngine?: () => SoundscaperAudioFreezeRenderEngine;
	/** Product-owned live state must be captured before the immutable freeze ticket. */
	readonly prepareProject?: () => PromiseLike<void> | void;
}

type ProjectTicket = SoundscaperFreezeTicket;

/** Bind the generic freeze transaction to browser rendering, PCM storage, and controller CAS. */
export function createSoundscaperAudioFreezeActions(
	environment: SoundscaperAudioFreezeEnvironment,
	controller: SoundscaperAudioFreezeController,
	options: SoundscaperAudioFreezeActionsOptions = {},
): Readonly<SoundscaperAudioFreezeActionBinding> {
	assertDependencies(environment, controller, options);
	const validateProject = options.validateProject ?? validateSoundscaperProject;
	const createId = options.createId ?? defaultId;
	const createRenderEngine = options.createRenderEngine ?? createAudioEditorEngine;
	const coordinator = createAudioTrackFreezeCoordinatorV21<
		SoundscaperProject, ProjectTicket, FreezeBody, FreezeStage
	>({
		controller: {
			capture: ({ trackId, signal }) => {
				throwIfAborted(signal);
				const project = exactCurrentProject(controller, validateProject);
				const track = exactRecordById(project.tracks, trackId, 'audio freeze track');
				if (track.type !== 'audio') throw new RangeError(`Track ${trackId} is not audio.`);
				if (track.locked === true) throw new Error(`Audio track ${trackId} is locked.`);
				return Object.freeze({
					project,
					ticket: captureSoundscaperFreezeProject(controller, project, trackId),
				});
			},
			assertCurrent: (ticket) => assertCurrent(controller, ticket),
			executeIfCurrent: (ticket, command, { signal }) => {
				throwIfAborted(signal);
			assertCurrent(controller, ticket);
			const result = controller.actions.edit.commit(command);
			const current = exactCurrentProject(controller, validateProject);
			if (result !== current && !sameProjectSnapshot(result, current)) {
				throw new Error('Audio freeze command did not publish the current project.');
			}
			return current;
			},
		},
		planRenderRange: ({ project, trackId }) => planFreezeRange(project, trackId),
		allocateDerivedSourceId: () => stableId(createId('source'), 'audio freeze derived source'),
		hashSourceContent: ({ project, source, signal }) => environment.playback.hashSourceContent(
			project.id, source, signal,
		),
		render: async (request) => renderFreezeBody(
			environment.store, controller, createRenderEngine, request, options,
		),
		hashRenderedBody: ({ body, signal }) => Promise.resolve(hashFreezeBody(body, signal)),
		stageDerivedSource: async (request) => stageFreezeSource(environment.store, request),
		verifyStagedSource: async ({ stage, sourceId, contentSha256, signal }) => {
			throwIfAborted(signal);
			if (stage.sourceId !== sourceId || stage.contentSha256 !== contentSha256
				|| stage.writer.framesWritten !== Number(stage.descriptor.frameCount)) {
				throw new Error('The staged freeze source failed exact geometry verification.');
			}
			return stage.descriptor;
		},
		admitVerifiedFreeze: (request) => environment.playback.admitVerifiedFreeze(request),
		publishStagedSource: async ({ stage, signal }) => {
			const authority = await stage.writer.commit({
				contentSha256: stage.contentSha256,
				frameCount: stage.descriptor.frameCount,
				channelCount: stage.descriptor.channelCount,
				sampleRate: stage.descriptor.sampleRate,
				chunkFrames: stage.descriptor.chunkFrames,
			}, { signal, ifAbsent: true });
			stage.authority = authority;
			const actual = await environment.playback.hashSourceContent(
				`freeze-stage:${stage.sourceId}`, stage.descriptor, signal,
			);
			if (actual !== stage.contentSha256) throw new Error('Published freeze PCM failed content verification.');
		},
		rollbackStagedSource: async ({ stage }) => {
			if (stage.authority === null) {
				await stage.writer.abort();
				return;
			}
			if (!await environment.store.discardSourceIfCurrent(stage.authority)) {
				throw new Error(`Published freeze source ${stage.sourceId} changed before rollback.`);
			}
		},
	});
	let active: Readonly<{ trackId: string; abort: AbortController; promise: Promise<unknown> }> | null = null;
	let disposed = false;
	const run = (trackId: string, operation: (signal: AbortSignal, assertOwner: () => void) => Promise<unknown>): Promise<unknown> => {
		if (disposed) return Promise.reject(new Error('Soundscaper audio freeze actions are disposed.'));
		const previous = active;
		previous?.abort.abort(new DOMException('A newer audio freeze operation replaced this task.', 'AbortError'));
		const abort = new AbortController();
		const promise = (async () => {
			const projectId = (controller.project as SoundscaperProject | null)?.id;
			const generation = projectId === undefined ? undefined : controller.captureProjectGeneration?.(projectId);
			const assertOwner = (): void => {
				if (generation) controller.assertProjectGeneration?.(generation);
				if ((controller.project as SoundscaperProject | null)?.id !== projectId) throw new EditorProjectChangedError();
			};
			if (previous) await previous.promise.catch(() => undefined);
			throwIfAborted(abort.signal);
			assertOwner();
			return operation(abort.signal, assertOwner);
		})();
		const entry = Object.freeze({ trackId, abort, promise });
		active = entry;
		void promise.finally(() => { if (active === entry) active = null; }).catch(() => undefined);
		return promise;
	};
	const freeze = (trackId: string) => run(trackId, async (signal, assertOwner) => {
		await options.prepareProject?.();
		throwIfAborted(signal);
		assertOwner();
		return coordinator.freeze({ trackId, signal });
	});
	const actions = Object.freeze({
		freeze,
		refresh: freeze,
		unfreeze: (trackId: string) => run(trackId, (signal) => coordinator.unfreeze({ trackId, signal })),
		commit: (trackId: string) => run(trackId, (signal) => {
			const project = exactCurrentProject(controller, validateProject);
			const track = exactRecordById(project.tracks, trackId, 'committed frozen track');
			assertSoundscaperFreezeHasNoSidechain(project, track);
			const freezeValue = dataRecord(track.audioFreeze, 'committed audio freeze');
			return coordinator.commit({
				trackId,
				derivedClip: committedFreezeClip(
					stableId(createId('clip'), 'committed freeze clip'), freezeValue,
				),
				signal,
			});
		}),
		getStatus: (trackId: string): SoundscaperAudioTrackFreezeStatus | 'verifying' => {
			if (active?.trackId === trackId) return 'verifying';
			if (disposed || !controller.project || typeof controller.project !== 'object') return 'unknown';
			return environment.playback.getFreezeStatus(controller.project, trackId);
		},
	});
	return Object.freeze({
		actions,
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			const pending = active;
			pending?.abort.abort(new DOMException('Audio freeze actions were disposed.', 'AbortError'));
			await pending?.promise.catch((error: unknown) => { if (!(error instanceof Error) || error.name !== 'AbortError') throw error; });
		},
	});
}

function committedFreezeClip(id: string, freeze: DataRecord): DataRecord {
	const sourceId = stableId(freeze.derivedSourceId, 'committed freeze source');
	const start = nonNegativeInteger(freeze.renderStartFrame, 'committed freeze start');
	const frames = positiveInteger(freeze.renderFrameCount, 'committed freeze frame count');
	return Object.freeze(createAudioClip({
		id, sourceId, title: 'Committed frozen track', anchor: 'sample',
		timelineStartFrame: start, durationFrames: frames,
		sourceStartFrame: 0, sourceDurationFrames: frames,
		trimStartFrames: 0, trimEndFrames: 0, gain: 1,
		fadeInFrames: 0, fadeOutFrames: 0, reversed: false,
		envelope: [], pitchCents: 0, speedRatio: 1,
	}));
}

function exactCurrentProject(
	controller: SoundscaperAudioFreezeController,
	validateProject: (project: unknown) => unknown = validateSoundscaperProject,
): SoundscaperProject {
	// Injected for the same reason as the automation target resolver: later
	// production revisions inherit this file, and only the validator differs.
	if (!validateProject(controller.project)) throw new TypeError('An exact Soundscaper production project must be open.');
	return controller.project as SoundscaperProject;
}

function assertCurrent(controller: SoundscaperAudioFreezeController, ticket: ProjectTicket): void {
	assertCurrentSoundscaperFreezeProject(controller, ticket);
}

function assertDependencies(
	environment: SoundscaperAudioFreezeEnvironment,
	controller: SoundscaperAudioFreezeController,
	options: SoundscaperAudioFreezeActionsOptions,
): void {
	if (!environment?.store || typeof environment.store.beginSourceWrite !== 'function'
		|| typeof environment.store.discardSourceIfCurrent !== 'function'
		|| typeof environment.playback?.hashSourceContent !== 'function'
		|| typeof environment.playback.admitVerifiedFreeze !== 'function') {
		throw new TypeError('The exact Soundscaper freeze environment is required.');
	}
	if (!controller?.actions?.edit || typeof controller.actions.edit.commit !== 'function') {
		throw new TypeError('The exact Soundscaper freeze controller is required.');
	}
	if (options.createId !== undefined && typeof options.createId !== 'function') throw new TypeError('Freeze createId must be a function.');
	if (options.createRenderEngine !== undefined && typeof options.createRenderEngine !== 'function') {
		throw new TypeError('Freeze createRenderEngine must be a function.');
	}
}

function defaultId(kind: 'source' | 'clip'): string {
	if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('Secure freeze ID allocation is unavailable.');
	return `soundscaper-audio-freeze-${kind}-${globalThis.crypto.randomUUID()}`;
}
