/* SPDX-License-Identifier: AGPL-3.0-only */
import { createFramescaperCaptureClockJournal, type FramescaperCaptureClockJournal } from './framescaper-capture-clock-journal.ts';
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
	readonly clockJournal?: FramescaperCaptureClockJournal;
	readonly durable: Pick<FramescaperCaptureDurablePort, 'recordPauseSpan'>;
	now(): number;
	recover(error: unknown): Promise<void>;
	notify(): void;
}

/** Pause every stream together; failed transitions retire the whole live graph. */
export function createFramescaperCapturePauseActions(dependencies: PauseDependencies) {
	let pending = Promise.resolve();
	let latest: Readonly<{ action: 'pause' | 'resume'; operation: Promise<void> }> | null = null;
	const journal = dependencies.clockJournal ?? createFramescaperCaptureClockJournal(dependencies.durable, dependencies.setSession);
	async function transition(action: 'pause' | 'resume'): Promise<void> {
		dependencies.assertActive();
		dependencies.machine[action]();
		try {
			const clock = dependencies.clock();
			if (!clock) throw new Error('Capture clock is unavailable.');
			let excludedPauseUs: number | undefined;
			let journalWrite: Promise<void> = Promise.resolve();
			if (action === 'pause') clock.pause(dependencies.now());
			else {
				const session = dependencies.session();
				if (!session) throw new Error('Capture recovery evidence is unavailable.');
				const resumed = journal.resume(clock, session, dependencies.now());
				journalWrite = resumed.settled;
				excludedPauseUs = resumed.excludedPauseUs;
			}
			const results = await Promise.allSettled([journalWrite, ...dependencies.recorders().map(recorder => Promise.resolve().then(
				() => action === 'pause' ? recorder.pause() : dependencies.machine.snapshot.phase === 'recording'
					? recorder.resume(excludedPauseUs) : true))]);
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
		if (latest?.action === action) return latest.operation;
		const operation = pending.then(() => transition(action));
		const request = { action, operation }; latest = request;
		pending = operation.catch(() => undefined);
		void operation.finally(() => { if (latest === request) latest = null; }).catch(() => undefined);
		return operation;
	}
	return Object.freeze({ pause: () => enqueue('pause'), resume: () => enqueue('resume'), settled: () => pending });
}
