/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAbortError } from './async-utils.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';

/** Audio time can pause; retire a bounded audition only once its last sample is reached. */
export function waitForPlaybackBoundary(engine: EngineRuntimeHost, frame: number, signal: AbortSignal, current: () => void): Promise<void> {
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
		const abort = (): void => { cleanup(); reject(createAbortError()); };
		const poll = (): void => {
			try {
				current();
				const remaining = frame - engine.getPositionFrames();
				if (remaining <= 0 || engine.state !== 'playing') { cleanup(); resolve(); return; }
				timer = setTimeout(poll, Math.max(1, Math.min(50, remaining / (engine.sampleRate * engine.playbackRate) * 1000)));
			} catch (error) { cleanup(); reject(error); }
		};
		signal.addEventListener('abort', abort, { once: true });
		poll();
	});
}
