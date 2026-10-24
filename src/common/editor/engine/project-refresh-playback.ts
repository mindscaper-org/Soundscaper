/* SPDX-License-Identifier: AGPL-3.0-only */
import { playbackSessionStart, restorePlaybackSessionStart } from './playback-session.ts';
import { playbackFrequencyRange } from './playback-frequency-range.ts';
import { isCutPreviewActive } from './cut-preview.ts';
import { ENGINE_EMIT_POSITION } from './runtime-symbols.ts';
import type { EngineRuntimeHost, EngineRuntimeMethodMap } from './runtime-types.ts';

/** Rebuild the edited graph without turning an active bounded audition into normal playback. */
export const engineProjectRefreshMethods = {
	applyProject(this: EngineRuntimeHost, project, sourceBuffers = this.sources, options = {}) {
		const wasPlaying = this.state === 'playing';
		// A pending Play is reissued after loadProject retires its old generation.
		const playRequested = this.pendingPlayRequest !== 0;
		const position = this.getPositionFrames();
		const sessionStart = playbackSessionStart(this);
		const playbackRate = this.playbackRate;
		const playbackMode = this.playbackMode;
		const cachedAudition = playbackMode === 'staffpad' || isCutPreviewActive(this);
		const preserveAudition = (wasPlaying || playRequested) && !cachedAudition
			&& project != null && this.project != null && this.project.id === project.id && this.project.sampleRate === project.sampleRate;
		const range = preserveAudition ? this.playRange : null;
		const frequencies = preserveAudition ? playbackFrequencyRange(this) : null;
		this.loadProject(project, sourceBuffers, { ...options, preserveLoudnessMeasurement: true });
		this.positionFrame = Math.min(position, this.playbackDurationFrames);
		if (preserveAudition) {
			const restored = this.setPlayRange(range);
			if (range && (!restored || position >= restored.endFrame)) {
				this.positionFrame = restored?.endFrame ?? this.positionFrame;
				this.setPlayRange(null);
				this[ENGINE_EMIT_POSITION]();
				return Promise.resolve();
			}
			this.setPlaybackFrequencyRange(frequencies);
		}
		restorePlaybackSessionStart(this, sessionStart);
		if (wasPlaying && playbackMode === 'naive') return this.playAtSpeed(playbackRate);
		// Cached StaffPad and joined cut mixes are stale after an edit.
		if (wasPlaying && !cachedAudition) return this.play();
		if (!wasPlaying && playRequested) return this.play();
		this[ENGINE_EMIT_POSITION]();
		return Promise.resolve();
	},
} satisfies EngineRuntimeMethodMap<'applyProject'>;
