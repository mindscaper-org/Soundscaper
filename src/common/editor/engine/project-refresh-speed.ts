/* SPDX-License-Identifier: AGPL-3.0-only */
import type { EnginePitchPreserver } from './public-api.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

const preservers = new WeakMap<EngineRuntimeHost, EnginePitchPreserver>();

export function rememberPlaybackPitchPreserver(engine: EngineRuntimeHost, renderer: EnginePitchPreserver | null): void {
	if (renderer) preservers.set(engine, renderer);
}

export function playbackPitchPreserver(engine: EngineRuntimeHost): EnginePitchPreserver {
	const renderer = preservers.get(engine);
	if (!renderer) throw new Error('The pitch-preserving playback renderer is unavailable.');
	return renderer;
}
