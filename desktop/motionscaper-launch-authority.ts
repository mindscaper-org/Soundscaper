/* SPDX-License-Identifier: AGPL-3.0-only */
import { extname, isAbsolute, normalize, resolve } from 'node:path';
import type { MotionDesktopLaunch } from '../src/motionscaper/desktop-launch-contract.ts';
import type { MotionOpenFileCapability } from '../src/motionscaper/desktop-file-contract.ts';
import { isAcceptedProjectFileExtension } from '../src/common/project-file-extensions.ts';

const MAXIMUM_PENDING = 16;
interface Opening { readonly path: string; readonly generation: number; requeued: boolean }
export interface MotionLaunchAuthority extends Pick<MotionDesktopLaunch, 'take' | 'acknowledge'> {
	enqueue(paths: readonly string[]): void;
	reset(): Promise<void>;
	dispose(): Promise<void>;
}

/** Parse OS arguments only; switches and non-project extensions confer no authority. */
export function motionLaunchPaths(argv: readonly string[], workingDirectory: string): readonly string[] {
	if (argv.length > 512 || !isAbsolute(workingDirectory)) throw new RangeError('Invalid Motionscaper launch arguments.');
	return argv.filter(value => !value.startsWith('-') && isAcceptedProjectFileExtension(extname(value)))
		.map(value => launchPath(resolve(workingDirectory, value)));
}

export function createMotionscaperLaunchAuthority(options: {
	open(path: string): Promise<MotionOpenFileCapability>; revoke(token: string): Promise<void>; notify(): void;
}): MotionLaunchAuthority {
	const pending: string[] = []; let generation = 0, disposed = false;
	const admitted = new Set<Promise<unknown>>(), tokens = new Set<string>(), revoking = new Map<string, Promise<void>>();
	let disposing: Promise<void> | null = null;
	let opening: Opening | null = null;
	let active: { readonly path: string; readonly capability: MotionOpenFileCapability } | null = null;
	let acknowledging = false;
	const available = () => { if (disposed) throw new Error('Motionscaper launch authority is closed.'); };
	const notify = () => { if (!disposed && pending.length && !active && !opening) options.notify(); };
	function track<Value>(action: () => Promise<Value>): Promise<Value> {
		let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (reason: unknown) => void;
		const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; }); admitted.add(promise);
		void promise.then(() => { admitted.delete(promise); }, () => { admitted.delete(promise); });
		try { void action().then(resolve, reject); } catch (error) { reject(error); } return promise;
	}
	function revoke(token: string): Promise<void> {
		const current = revoking.get(token); if (current) return current;
		const operation = Promise.resolve().then(() => options.revoke(token)).then(() => { tokens.delete(token); });
		revoking.set(token, operation);
		void operation.then(() => { revoking.delete(token); }, () => { revoking.delete(token); }); return operation;
	}
	const authority: MotionLaunchAuthority = {
		enqueue(paths) {
			available(); if (paths.length > MAXIMUM_PENDING) throw new RangeError('Too many pending Motionscaper file launches.');
			const additions = [...new Set(paths.map(launchPath))].filter(path => !pending.includes(path) && path !== active?.path && path !== opening?.path);
			const activeReservation = active && !tokens.has(active.capability.token) ? 1 : 0;
			if (pending.length + additions.length + tokens.size + activeReservation + (opening && !opening.requeued ? 1 : 0) > MAXIMUM_PENDING) throw new RangeError('Too many pending Motionscaper file launches.');
			pending.push(...additions); notify();
		},
		async take() {
			available(); if (active || opening) return null;
			if (tokens.size >= MAXIMUM_PENDING) throw new RangeError('Motionscaper launch cleanup capacity is full.');
			const path = pending.shift(); if (!path) return null;
			const claim = { path, generation, requeued: false }; opening = claim;
			try {
				const capability = await options.open(path);
				tokens.add(capability.token);
				if (disposed || claim.generation !== generation) { await revoke(capability.token); return null; }
				active = { path, capability }; return capability;
			} finally { opening = null; notify(); }
		},
		async acknowledge({ token }) {
			available(); const current = active;
			if (!current || current.capability.token !== token || acknowledging) throw new Error('Unknown or busy Motionscaper active launch.');
			acknowledging = true;
			try { await revoke(token); if (active === current) active = null; }
			finally { acknowledging = false; notify(); }
		},
		async reset() {
			if (disposed) return; generation += 1;
			if (opening && !opening.requeued) { pending.unshift(opening.path); opening.requeued = true; }
			const current = active;
			if (current) { await revoke(current.capability.token); if (active === current) { active = null; pending.unshift(current.path); } }
			notify();
		},
		dispose() {
			if (disposing) return disposing; disposed = true; generation += 1; pending.length = 0;
			const operation = Promise.resolve().then(async () => {
				while (admitted.size) await Promise.allSettled([...admitted]);
				const results = await Promise.allSettled([...tokens].map(revoke));
				const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
				if (failures.length) throw new AggregateError(failures, 'Motionscaper launch cleanup failed.');
				active = null;
			});
			disposing = operation;
			void operation.catch(() => { if (disposing === operation) disposing = null; }); return operation;
		},
	};
	return Object.freeze({ ...authority, take: () => track(() => authority.take()),
		acknowledge: (request: Parameters<MotionLaunchAuthority['acknowledge']>[0]) => track(() => authority.acknowledge(request)),
		reset: () => track(() => authority.reset()),
	});
}
function launchPath(path: string): string {
	if (typeof path !== 'string' || path.length > 8192 || path.includes('\0') || !isAbsolute(path)) throw new TypeError('Motionscaper native launch requires a bounded absolute path.');
	if (!isAcceptedProjectFileExtension(extname(path))) throw new TypeError('Motionscaper native launch requires a shared project archive suffix.');
	return normalize(path);
}
