/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveAdmEbuChannelWeights } from '../loudness-channel-layout.ts';
import { clearPreparedAudioWarpPlayback } from './audio-warp-fallback.ts';
import { getProjectDurationFrames, getProjectTimelineDurationFrames, normalizeLoop } from './buffer-math.ts';
import { configureMasterLoudnessMeterChannelCount, configureNativeSurroundDestination } from '../surround-monitoring.ts';
import { inheritTrackFolderMediaStateProjectionV12, projectTrackFolderMediaStateV12 } from '../track-folder-media-runtime.ts';
import { resolveProjectGraphSelection } from './project-graph-selection.ts';
import { resolveTimePitchPlaybackProject } from '../clip-time-pitch-playback-projection.ts';
import { capturePlaybackSourceResolver } from './playback-source-resolver.ts';
import { throwIfAborted } from './async-utils.ts';
import { ENGINE_ASSERT_ACTIVE, ENGINE_CANCEL_SCRUB, ENGINE_HALT_GRAPH, ENGINE_SET_STATE, ENGINE_EMIT_POSITION } from './runtime-symbols.ts';
import type { EngineRuntimeMethodMap } from './runtime-types.ts';

export const engineProjectLoadingMethods = {
loadProject(project, sourceBuffers = new Map(), options = {}) {
		this[ENGINE_ASSERT_ACTIVE]();
		throwIfAborted(options.signal);
		this[ENGINE_CANCEL_SCRUB]();
		this[ENGINE_HALT_GRAPH]();
		const mediaProject = project ? projectTrackFolderMediaStateV12(project) : project;
		const resolvedProject = mediaProject?.schemaVersion
			? resolveTimePitchPlaybackProject(mediaProject)
			: mediaProject;
		const runtimeProject = mediaProject && resolvedProject
			? inheritTrackFolderMediaStateProjectionV12(mediaProject, resolvedProject)
			: resolvedProject;
		this.project = runtimeProject || null;
		capturePlaybackSourceResolver(this);
		// One builder per session. Resolved here, and only here, so a scheduler,
		// a scrub and a render of this project can never disagree about it.
		this.projectGraphSelection = runtimeProject
			? options.graph ?? resolveProjectGraphSelection(runtimeProject)
			: null;
		if (this.context && runtimeProject) {
			configureNativeSurroundDestination(this.context.destination, Number(runtimeProject.masterChannels) || 2);
		}
		const meterChannelCount = this.context && runtimeProject
			? configureMasterLoudnessMeterChannelCount(this.context.destination, runtimeProject.masterChannels)
			: null;
		const runtimeMetadata = runtimeProject?.metadata;
		const meterChannelWeights = meterChannelCount === null ? null : resolveAdmEbuChannelWeights(
			runtimeMetadata && typeof runtimeMetadata === 'object' && 'adm' in runtimeMetadata
				? runtimeMetadata.adm
				: null,
			meterChannelCount,
		);
		if (this.masterLoudnessMeterChannelCount !== meterChannelCount
			|| this.masterLoudnessMeterChannelWeights !== meterChannelWeights) {
			this.masterLoudnessMeter?.dispose();
			this.masterLoudnessMeter = null;
			this.masterLoudnessMeterChannelCount = null;
			this.masterLoudnessMeterChannelWeights = null;
			this.masterLoudnessMeterPromise = null;
			this.masterLoudnessMeterError = null;
		}
		this.sources = sourceBuffers instanceof Map ? new Map(sourceBuffers) : new Map(Object.entries(sourceBuffers || {}));
		if (options.chunkSources !== undefined) this.setChunkSources(options.chunkSources);
		this.durationFrames = getProjectDurationFrames(runtimeProject);
		this.playbackDurationFrames = getProjectTimelineDurationFrames(runtimeProject);
		this.playbackRate = 1;
		this.playbackMode = 'normal';
		this.preparedSpeedPlayback = null;
		clearPreparedAudioWarpPlayback(this);
		this.positionFrame = Math.min(this.positionFrame, this.playbackDurationFrames);
		this.playEndFrame = this.playbackDurationFrames;
		this.loop = normalizeLoop(runtimeProject?.loop, this.playbackDurationFrames, this.durationFrames);
		this.playRange = null;
		// The graph stops here, so the meter always stops with it; `play()` re-arms it
		// with the manual pause honoured. Retiring the measurement itself belongs to a
		// genuinely new project, not to re-applying the edited one.
		this.masterLoudnessMeter?.setRunning(false);
		if (!options.preserveLoudnessMeasurement) {
			this.loudnessMeasurementManuallyPaused = false;
			this.masterLoudnessMeter?.reset();
			this.latestMasterLoudnessMeter = null;
		}
		this[ENGINE_SET_STATE](runtimeProject ? 'stopped' : 'empty');
		this[ENGINE_EMIT_POSITION]();
		return this;
	},
} satisfies EngineRuntimeMethodMap<'loadProject'>;
