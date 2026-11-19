/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbsentAnalysisService } from './internal/absent-analysis-service.ts';
import { createAnalysisRenderer, type AnalysisRenderDependencies, type AnalysisRenderProject } from './internal/analysis-renderer.ts';
import type { AnalysisDependencies, AnalysisState } from './analysis-service.ts';
import { createEditorAnalysisVisuals } from './internal/analysis-visuals.ts';
import { createDeferredAudioAnalysisService } from './internal/deferred-analysis-service.ts';
import type { EditorProjectGeneration } from '../shared/lifecycle.ts';
import type { EditorTaskProgressCoordinator } from '../shared/task-progress.ts';
import { resolveSelectionRange } from '../../selection-range.ts';
import { calculateAudioAnalysisReportInWorker } from '../../audio-analysis-report-worker-client.ts';
import type { RepeatedSoundOptions, RepeatedSoundResult } from '../../repeated-sound.ts';
import type { AudioEditorCommand } from '../../commands/protocol.ts';
import { EditorProjectChangedError } from '../shared/lifecycle.ts';
import type { MacroAudioInput } from '../../macro-audio-input.ts';

interface AnalysisWorkerCopy {
	readonly audioAnalysisWorkerFailed: string;
	readonly audioAnalysisFailed: string;
}

export type AnalysisWorkerPort = (
	channels: Float32Array[],
	sampleRate: number,
	copy: AnalysisWorkerCopy,
	chunkFrames: number,
	signal: AbortSignal,
	options?: Parameters<AnalysisDependencies['analyzeChannels']>[3],
) => Promise<unknown>;

type AnalysisProject = AnalysisRenderProject & ReturnType<AnalysisDependencies['getProject']>;
type AnalysisTrack = AnalysisRenderProject['tracks'][number] & {
	readonly name?: string;
	readonly color?: string;
	readonly clipIds?: readonly string[];
};
export type AnalysisCompositionState = AnalysisState & {
	selectedTrackId: string | null;
	selectedClipId?: string | null;
	analysisProcessing: boolean;
	contrastSelections: ReturnType<AnalysisDependencies['getContrastSelections']>;
	preferences?: { readonly spectrogram?: { readonly windowSize?: number } };
};

export type AnalysisActions = ReturnType<typeof createDeferredAudioAnalysisService> & {
	findRepeatedSound(options?: RepeatedSoundOptions, signal?: AbortSignal, reference?: MacroAudioInput): Promise<RepeatedSoundResult>;
};

export interface AnalysisCompositionDependencies<Project extends AnalysisProject, Buffers>
	extends Omit<AnalysisRenderDependencies<Project, Buffers>, 'getProject' | 'getSelectedTrackId' | 'copy'> {
	readonly enabled: boolean;
	readonly productName: string;
	readonly state: AnalysisCompositionState;
	readonly copy: AnalysisDependencies['copy'] & AnalysisRenderDependencies<Project, Buffers>['copy']
		& AnalysisWorkerCopy & Readonly<Record<string, string>>;
	readonly commit?: (command: AudioEditorCommand) => unknown;
	readonly lifetime: AnalysisDependencies['lifetime'];
	readonly projectGeneration: Pick<EditorProjectGeneration, 'capture' | 'assertCurrent'>;
	readonly getProject: () => Project | null;
	readonly getActiveSelection: AnalysisDependencies['getActiveSelection'];
	/** The owner may attest an immutable document/render generation; mutable callers leave this absent. */
	readonly getImmutableProjectGeneration?: () => object | null;
	readonly projectDurationFrames: (project: Project) => number;
	readonly store: Pick<AnalysisDependencies, 'loadAnalysis' | 'saveAnalysis'>;
	readonly taskProgress: Pick<EditorTaskProgressCoordinator, 'run'>;
	readonly showAnalysis: AnalysisDependencies['showAnalysis'];
	readonly setStatus: AnalysisDependencies['setStatus'];
	readonly publish: AnalysisDependencies['publish'];
	readonly batchPresentation?: AnalysisDependencies['batchPresentation'];
	readonly handleError: AnalysisDependencies['handleError'];
	/** Browser worker transport supplied by the application composition root. */
	readonly analyzeChannels: AnalysisWorkerPort;
}

/** Own analysis wiring, lazy execution and progress while retaining eager cancellation. */
export function createAnalysisComposition<Project extends AnalysisProject, Buffers>(
	dependencies: AnalysisCompositionDependencies<Project, Buffers>,
): AnalysisActions {
	const { state, copy } = dependencies;
	const analyzeChannels = dependencies.analyzeChannels;
	const requireProject = (): Project => {
		const project = dependencies.getProject();
		if (!project) throw new Error('Analysis requires an open project.');
		return project;
	};
	const currentSelection = () => dependencies.getActiveSelection()
		?? resolveSelectionRange(requireProject(), { selectedClipId: state.selectedClipId ?? null });
	const renderAudio = createAnalysisRenderer({ ...dependencies, getProject: requireProject, getSelectedTrackId: () => state.selectedTrackId });
	const findRepeatedSound = async (options: RepeatedSoundOptions = {}, signal?: AbortSignal, reference?: MacroAudioInput): Promise<RepeatedSoundResult> => {
		dependencies.lifetime.assertActive(); signal?.throwIfAborted();
		if (!dependencies.enabled) throw new Error(`${dependencies.productName} does not compose the analysis subsystem.`);
		const token = dependencies.projectGeneration.capture(requireProject().id), revision = requireProject().revision;
		const current = currentSelection(), selection = current ? { ...current, trackIds: current.trackIds?.slice() } : null;
		const selectedTrackId = state.selectedTrackId, parameters = { ...options };
		const { createRepeatedSoundService } = await import('./internal/repeated-sound-service.ts');
		dependencies.projectGeneration.assertCurrent(token);
		signal?.throwIfAborted();
		if (requireProject().revision !== revision) throw new EditorProjectChangedError();
		const result = await createRepeatedSoundService({ lifetime: dependencies.lifetime, copy,
			getProject: requireProject, captureProject: () => token, assertProject: value => dependencies.projectGeneration.assertCurrent(value),
			getSelection: () => selection, getSelectedTrackId: () => selectedTrackId, projectSampleRate: dependencies.projectSampleRate,
			projectDurationFrames: () => dependencies.projectDurationFrames(requireProject()), renderAudio,
			commit: command => { if (!dependencies.commit) throw new Error('Label publication is unavailable.'); return dependencies.commit(command); },
			setProcessing: value => { state.analysisProcessing = value; }, publish: dependencies.publish,
		})(parameters, signal, reference);
		if (!reference) state.lastAnalysisRequest = { type: 'repeated-sound', options: { similarityThreshold: parameters.similarityThreshold ?? .9 } };
		dependencies.publish();
		return result;
	};
	const service = dependencies.enabled ? createDeferredAudioAnalysisService({
		findRepeatedSound,
		lifetime: dependencies.lifetime, copy, state,
		captureProject: () => dependencies.projectGeneration.capture(dependencies.getProject()?.id ?? null),
		assertProject: (token) => dependencies.projectGeneration.assertCurrent(token),
		getProject: requireProject,
		captureDocumentGeneration: dependencies.getImmutableProjectGeneration
			? () => dependencies.getImmutableProjectGeneration?.() ?? null : undefined,
		getSelectedTrackId: () => state.selectedTrackId,
		getSpectrumTracks: () => {
			const project = requireProject();
			const selected = new Set(resolveSelectionRange(project, { selectedClipId: state.selectedClipId ?? null })?.trackIds ?? []);
			const tracks: readonly AnalysisTrack[] = project.tracks;
			return tracks.filter(track => track.type === 'audio' && track.clipIds?.length && selected.has(track.id))
				.map(track => ({ id: track.id, name: track.name ?? track.id, color: track.color ?? 'blue' }));
		},
		getRange: () => {
			const selection = currentSelection();
			return Object.freeze({
				startFrame: selection?.startFrame ?? 0,
				endFrame: selection?.endFrame ?? dependencies.projectDurationFrames(requireProject()),
			});
		},
		getActiveSelection: currentSelection,
		captureLoudnessGeneration: dependencies.getImmutableProjectGeneration ? () => {
			const generation = dependencies.hasMissingTimelineSources() ? null : dependencies.getImmutableProjectGeneration?.();
			return generation ? { generation, sampleRate: dependencies.projectSampleRate() } : null;
		} : undefined,
		getSpectrumWindowSize: () => state.preferences?.spectrogram?.windowSize ?? 2048,
		getContrastSelections: () => state.contrastSelections,
		setContrastSelections: (value) => { state.contrastSelections = value; },
		loadAnalysis: (key) => dependencies.store.loadAnalysis(key),
		saveAnalysis: (key, value) => dependencies.store.saveAnalysis(key, value),
		renderAudio,
		analyzeChannels: async (channels, sampleRate, signal, options) => {
			const result = await analyzeChannels(channels, sampleRate, copy, 65536, signal, options);
			if (!isAnalysisResult(result)) throw new TypeError('The analysis worker returned an invalid result.');
			return result;
		},
		createVisuals: createEditorAnalysisVisuals,
		createSpecializedReport: (kind, scope, range, channels, sampleRate, options, signal) => calculateAudioAnalysisReportInWorker({ kind, scope, range, channels, sampleRate, options }, { signal }),
		measureLoudnessChannels: async (channels, sampleRate, range, channelWeights, signal) => {
			const report = await calculateAudioAnalysisReportInWorker({ kind: 'loudness', scope: 'master', range, channels, sampleRate, options: {}, channelWeights }, { signal });
			if (!('subject' in report)) throw new TypeError('The loudness worker returned an invalid report.');
			return report;
		},
		showAnalysis: dependencies.showAnalysis,
		setProcessing: (processing) => { state.analysisProcessing = processing; },
		setStatus: dependencies.setStatus, publish: dependencies.publish, batchPresentation: dependencies.batchPresentation, handleError: dependencies.handleError,
	}) : createAbsentAnalysisService({ productName: dependencies.productName });
	return Object.freeze({
		...service,
		findRepeatedSound: (options?: RepeatedSoundOptions, signal?: AbortSignal, reference?: MacroAudioInput) => dependencies.taskProgress.run('analysis', copy.findRepeatedSound!, task => {
			const cancellation = new AbortController();
			task.setCancellation(() => cancellation.abort(new DOMException('The analysis was cancelled.', 'AbortError')));
			return findRepeatedSound(options, signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal, reference);
		}, undefined, { key: 'findRepeatedSound' }),
		run: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.run(...args), undefined, { key: "analysisRendering" }),
		plotSpectrum: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.plotSpectrum(...args), undefined, { key: "analysisRendering" }),
		findClipping: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.findClipping(...args), undefined, { key: "analysisRendering" }),
		captureContrast: (...args) => dependencies.taskProgress.run('analysis', copy.contrastAnalyzing, () => service.captureContrast(...args), undefined, { key: "contrastAnalyzing" }),
		repeatLast: (...args) => dependencies.taskProgress.run('analysis', copy.analysisRendering, () => service.repeatLast(...args), undefined, { key: "analysisRendering" }),
		measureLoudness: (...args) => dependencies.taskProgress.run('analysis', copy.measuringLoudness, () => service.measureLoudness(...args), undefined, { key: "measuringLoudness" }),
	});
}

function isAnalysisResult(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
