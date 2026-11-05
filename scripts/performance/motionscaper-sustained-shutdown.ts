/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionProcessIdentity } from './motionscaper-sustained-process.ts';

export interface MotionApplicationExit { readonly code: number | null; readonly signal: NodeJS.Signals | null }
interface ShutdownOptions {
	readonly owner: MotionProcessIdentity | undefined;
	retained(): readonly MotionProcessIdentity[];
	prepare(signal: AbortSignal): Promise<void>;
	readonly closed: Promise<MotionApplicationExit>;
	isAlive(identity: MotionProcessIdentity): Promise<boolean>;
	send(identity: MotionProcessIdentity, signal: NodeJS.Signals): void | Promise<void>;
	signalUnadmitted(signal: NodeJS.Signals): void;
	waitGone(identities: readonly MotionProcessIdentity[]): Promise<void>;
}
interface ShutdownSignal {
	readonly identity: MotionProcessIdentity | null; readonly signal: NodeJS.Signals;
	readonly phase: string; readonly observedAt: string; readonly result: string;
}

type Outcome<T> = Readonly<{ state: 'value'; value: T } | { state: 'error'; error: unknown } | { state: 'deadline' }>;

/** Keep the original absolute 10s escalation; unresolved work fails within a further 20s.
 * A failed receipt retains custody. It never turns an absent exit event into physical closure. */
export async function shutdownMotionSustainedApplication(options: ShutdownOptions) {
	const errors: unknown[] = [], signals: ShutdownSignal[] = [];
	const identities = () => [...new Map([...options.retained(), ...(options.owner ? [options.owner] : [])]
		.map(value => [`${value.pid}:${value.startTicks}`, value])).values()];
	let active = true, escalated = false, exit: MotionApplicationExit | null = null, goneVerified = false;
	const pending = new Set<string>();
	const preparation = new AbortController();
	const expired = { state: 'deadline' } as const;
	let expire!: (value: typeof expired) => void, escalate!: (value: typeof expired) => void;
	const deadline = new Promise<typeof expired>(resolve => { expire = resolve; });
	const escalationReached = new Promise<typeof expired>(resolve => { escalate = resolve; });
	const finalTimer = setTimeout(() => { active = false; expire(expired); }, 30000);
	const run = async <T>(label: string, operation: () => Promise<T>, earlier?: Promise<typeof expired>): Promise<Outcome<T>> => {
		if (!active) return expired;
		pending.add(label);
		let work: Promise<T>;
		try { work = operation(); } catch (error) { work = Promise.reject(error); }
		const settled = work.then<Outcome<T>, Outcome<T>>(value => ({ state: 'value', value }), error => ({ state: 'error', error }))
			.then(value => { pending.delete(label); return value; });
		const result = await Promise.race([settled, deadline, ...(earlier ? [earlier] : [])]);
		if (result.state === 'error') errors.push(result.error);
		if (result.state === 'deadline') errors.push(new Error(`Application cleanup ${label} deadline exceeded; completion remains unknown.`));
		return result;
	};
	// The child can close while preparation is stuck. Preserve that actual event independently.
	const observedExit = options.closed.then(value => { if (active) exit = value; return value; });
	void observedExit.catch(() => undefined);
	let journalExceeded = false;
	const record = (value: ShutdownSignal) => {
		if (signals.length < 256) signals.push(value);
		else if (!journalExceeded) { journalExceeded = true; errors.push(new Error('Application shutdown signal journal admission exceeded.')); }
	};
	const signal = async (values: readonly MotionProcessIdentity[], requested: NodeJS.Signals, phase: string, includeUnadmitted = false) => {
		for (const identity of values) {
			if (!active || requested === 'SIGTERM' && escalated) return;
			try {
				const alive = await options.isAlive(identity);
				if (!active || requested === 'SIGTERM' && escalated) return; // Late authentication cannot resume graceful signalling.
				if (!alive) continue;
				await options.send(identity, requested);
				if (!active) return;
				record({ identity, signal: requested, phase, observedAt: new Date().toISOString(), result: 'sent' });
			} catch (error) { if (active) { errors.push(error); record({ identity, signal: requested, phase, observedAt: new Date().toISOString(), result: String(error) }); } }
		}
		if (active && !(requested === 'SIGTERM' && escalated) && !options.owner && includeUnadmitted) {
			try { options.signalUnadmitted(requested); record({ identity: null, signal: requested, phase, observedAt: new Date().toISOString(), result: 'actual ChildProcess authority before identity admission' }); }
			catch (error) { errors.push(error); }
		}
	};
	let escalation: Promise<Outcome<void>> | undefined;
	const timer = setTimeout(() => {
		escalated = true;
		preparation.abort(new Error('Application cleanup preparation deadline exceeded.'));
		errors.push(new Error('Application cleanup escalation deadline exceeded.'));
		escalate(expired);
		escalation = run('deadline-signals', () => signal(identities(), 'SIGKILL', 'deadline', true));
	}, 10000);
	try {
		const prepared = await run('preparation', () => options.prepare(preparation.signal), escalationReached);
		let retired!: () => void;
		const ownerRetired = new Promise<void>(resolve => { retired = resolve; });
		const retireOwner = async () => {
			try {
				if (!escalated) await run('owner-term', () => signal(options.owner ? [options.owner] : [], 'SIGTERM', 'graceful-owner', true));
				const closed = await run('owner-exit', () => observedExit);
				if (closed.state !== 'value') return;
				const value = closed.value;
				if (!(value.code === 0 && value.signal === null) && !(value.code === null && value.signal === 'SIGTERM')) errors.push(new Error('Application closed with an unqualified exit code or signal.'));
				if (!escalated) await run('residual-term', () => signal(identities().filter(value => !options.owner || value.pid !== options.owner.pid || value.startTicks !== options.owner.startTicks), 'SIGTERM', 'residual-descendants'));
			} finally { retired(); }
		};
		const verifyAbsence = async () => {
			// Preserve normal graceful ordering, but a lost child-close event must not
			// suppress independent PID/start absence checks after escalation.
			await run('absence-authority', () => Promise.race([ownerRetired, escalationReached]));
			const gone = await run('identity-absence', () => options.waitGone(identities()));
			if (gone.state === 'value') { goneVerified = true; return; }
			await run('remaining-kill', () => signal(identities(), 'SIGKILL', 'remaining-descendants'));
			goneVerified = (await run('final-identity-absence', () => options.waitGone(identities()))).state === 'value';
		};
		await Promise.all([retireOwner(), verifyAbsence()]);
		if (escalation) await escalation;
		if (prepared.state !== 'value') goneVerified = false;
	} finally {
		active = false; preparation.abort(new Error('Application cleanup retired.')); clearTimeout(timer); clearTimeout(finalTimer);
	}
	const unresolved = [...pending];
	return { exit, errors: [...errors], signals: [...signals], identities: identities(), unresolved,
		physicalClosure: exit !== null && goneVerified && !unresolved.length ? 'verified' as const : 'unknown' as const };
}
