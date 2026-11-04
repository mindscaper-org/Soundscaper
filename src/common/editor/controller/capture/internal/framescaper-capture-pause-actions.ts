/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperCaptureRecorder, FramescaperCaptureDurablePort, FramescaperCaptureDurableSession } from '../framescaper-capture-session-types.ts';
import type { FramescaperCaptureActiveTimeClock } from './framescaper-capture-active-time-clock.ts';
import type { FramescaperCaptureStateMachine } from './framescaper-capture-state-machine.ts';

interface PauseDependencies {
	assertActive(): void;
	readonly machine: Pick<FramescaperCaptureStateMachine, 'pause' | 'resume' | 'snapshot'>;
	clock(): FramescaperCaptureActiveTimeClock | null;
	session(): FramescaperCaptureDurableSession | null;
	setSession(session: FramescaperCaptureDurableSession): void;
	recorders(): readonly FramescaperCaptureRecorder[];
	readonly durable: Pick<FramescaperCaptureDurablePort, 'recordPauseSpan'>;
	now(): number;
	recover(error: unknown): Promise<void>;
	notify(): void;
}

/** Pause every stream together; failed transitions retire the whole live graph. */
export function createFramescaperCapturePauseActions(dependencies: PauseDependencies) {
	let pending = Promise.resolve();
	async function transition(action: 'pause' | 'resume'): Promise<void> {
		dependencies.assertActive();
		dependencies.machine[action]();
		try {
			const clock = dependencies.clock();
			if (!clock) throw new Error('Capture clock is unavailable.');
			let excludedPauseUs: number | undefined;
			if (action === 'pause') clock.pause(dependencies.now());
			else {
				const session = dependencies.session();
				if (!session) throw new Error('Capture recovery evidence is unavailable.');
				const snapshot = clock.resume(dependencies.now());
				const span = snapshot.pauseSpans.at(-1)!;
				const next = await dependencies.durable.recordPauseSpan(session, {
					startMicroseconds: Math.round((span.startedAtMs - snapshot.startedAtMs) * 1000),
					endMicroseconds: Math.round((span.endedAtMs - snapshot.startedAtMs) * 1000),
				});
				if (!['recording', 'finalizing'].includes(dependencies.machine.snapshot.phase)) return;
				dependencies.setSession(next);
				if (dependencies.machine.snapshot.phase !== 'recording') return;
				excludedPauseUs = Math.round(span.durationMs * 1000);
			}
			const results = await Promise.allSettled(dependencies.recorders().map(recorder => Promise.resolve().then(
				() => action === 'pause' ? recorder.pause() : recorder.resume(excludedPauseUs))));
			const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown]
				: result.value === false ? [new Error(`Capture recorder could not ${action}.`)] : []);
			if (failures.length === 1) throw failures[0];
			if (failures.length) throw new AggregateError(failures, `Capture recorders could not ${action} together.`);
			dependencies.notify();
		} catch (error) {
			await dependencies.recover(error);
			throw error;
		}
	}
	function enqueue(action: 'pause' | 'resume'): Promise<void> {
		const operation = pending.then(() => transition(action));
		pending = operation.catch(() => undefined);
		return operation;
	}
	return Object.freeze({ pause: () => enqueue('pause'), resume: () => enqueue('resume'), settled: () => pending });
}
