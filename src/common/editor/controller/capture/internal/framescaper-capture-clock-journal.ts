/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperCaptureDurablePort, FramescaperCaptureDurableSession, FramescaperCaptureRecorder } from '../framescaper-capture-session-types.ts';
import type { FramescaperCaptureActiveTimeClock } from './framescaper-capture-active-time-clock.ts';
import type { FramescaperCaptureRecorderStartFence } from './framescaper-capture-recorder-start.ts';

/** Media starts with its encoders; the corresponding journal write gates packet acceptance. */
export function createFramescaperCaptureClockJournal(
	durable: Pick<FramescaperCaptureDurablePort, 'recordPauseSpan'>,
	setSession: (session: FramescaperCaptureDurableSession) => void,
) {
	let pending: Promise<void> = Promise.resolve();
	function resume(clock: FramescaperCaptureActiveTimeClock, session: FramescaperCaptureDurableSession, atMs: number) {
		const snapshot = clock.resume(atMs);
		const span = snapshot.pauseSpans.at(-1)!;
		pending = span.durationMs > 0 ? durable.recordPauseSpan(session, {
			startMicroseconds: Math.round((span.startedAtMs - snapshot.startedAtMs) * 1000),
			endMicroseconds: Math.round((span.endedAtMs - snapshot.startedAtMs) * 1000),
		}).then(next => { setSession(next); }) : Promise.resolve();
		void pending.catch(() => undefined);
		return { settled: pending, activeTimeUs: snapshot.activeTimeUs, excludedPauseUs: Math.round(span.durationMs * 1000) };
	}
	return Object.freeze({ resume, settled: () => pending,
		async start(clock: FramescaperCaptureActiveTimeClock, session: FramescaperCaptureDurableSession, atMs: number,
			recorders: readonly Readonly<{ recorder: FramescaperCaptureRecorder }>[], fence: FramescaperCaptureRecorderStartFence, isActive: () => boolean) {
			const resumed = resume(clock, session, atMs);
			await Promise.all([resumed.settled, fence.start(recorders, resumed.activeTimeUs, isActive)]);
		},
	});
}
export type FramescaperCaptureClockJournal = ReturnType<typeof createFramescaperCaptureClockJournal>;
