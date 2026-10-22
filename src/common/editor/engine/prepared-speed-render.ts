/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAbortError, throwIfAborted } from './async-utils.ts';
import { assertPlayAtSpeedStaffPadMemorySafe, audioBufferChannels, normalizePreparedSpeedPlayback } from './buffer-math.ts';
import { resolveRenderTailSeconds } from './rendering-range.ts';
import type { EnginePitchPreserver, EngineProgress } from './public-api.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

/** Listening includes the same bounded audible release as an ordinary mix render. */
export function preparedSpeedTimelineFrames(engine: EngineRuntimeHost): number {
	return engine.durationFrames + (engine.project
		? Math.round(resolveRenderTailSeconds(engine.project, true) * engine.sampleRate) : 0);
}

export function assertPreparedSpeedMemorySafe(engine: EngineRuntimeHost, speed: number): void {
	assertPlayAtSpeedStaffPadMemorySafe(preparedSpeedTimelineFrames(engine), engine.sampleRate, speed);
}

export async function prepareSpeedRender(engine: EngineRuntimeHost, speed: number, preservePitch: EnginePitchPreserver,
	signal: AbortSignal | null, onProgress: ((progress: EngineProgress) => void) | null, assertCurrent: () => void): Promise<void> {
	if (engine.preparedSpeedPlayback?.playbackRate === speed) return;
	const project = engine.project;
	const rendered = await engine.renderMix({ startFrame: 0, endFrame: engine.durationFrames, includeTail: true, signal, onProgress });
	throwIfAborted(signal); assertCurrent();
	const channels = audioBufferChannels(rendered);
	const frames = channels[0]!.length;
	assertPlayAtSpeedStaffPadMemorySafe(frames, engine.sampleRate, speed);
	const processed = await preservePitch(channels, engine.sampleRate, speed, { signal, onProgress });
	throwIfAborted(signal); assertCurrent();
	if (engine.project !== project) throw createAbortError();
	engine.preparedSpeedPlayback = normalizePreparedSpeedPlayback(processed, engine.sampleRate, frames, speed);
}
