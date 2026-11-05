/* SPDX-License-Identifier: AGPL-3.0-only */

type CoverageCleanup = () => unknown | Promise<unknown>;

function throwFailures(failures: unknown[]): void {
	const unique = [...new Set(failures)];
	if (unique.length === 1) throw unique[0];
	if (unique.length > 1) throw new AggregateError(unique, 'Browser coverage collection or cleanup failed.');
}

/** Drain siblings and work they enqueue before releasing any of their resources. */
export async function drainCoverageWork(pending: Promise<unknown>[]): Promise<void> {
	const failures: unknown[] = [];
	while (pending.length > 0) {
		const batch = await Promise.allSettled(pending.splice(0));
		for (const result of batch) if (result.status === 'rejected') failures.push(result.reason);
	}
	throwFailures(failures);
}

/** A failed fixture settlement must never become an accepted partial profile later. */
export function createCoverageWorkSettlement(pending: Promise<unknown>[]): () => Promise<void> {
	const failures: unknown[] = [];
	return async () => {
		try { await drainCoverageWork(pending); } catch (error) { failures.push(error); }
		throwFailures(failures);
	};
}

/** Every teardown action runs even when an earlier action failed. */
export async function cleanupCoverage(actions: CoverageCleanup[]): Promise<void> {
	const failures: unknown[] = [];
	for (const action of actions) {
		try { await action(); } catch (error) { failures.push(error); }
	}
	throwFailures(failures);
}

export async function withCoverageCleanup<Value>(
	collect: () => Promise<Value>, cleanup: () => Promise<void>,
): Promise<Value> {
	const failures: unknown[] = [];
	let value!: Value;
	try { value = await collect(); } catch (error) { failures.push(error); }
	try { await cleanup(); } catch (error) { failures.push(error); }
	throwFailures(failures);
	return value;
}

interface PageCoverageRecorder {
	active: boolean;
	cleanupStarted?: boolean;
	page: { isClosed(): boolean };
	navigationCheckpoints: { dispose(): Promise<void> } | null;
	pageOperationCheckpoints: { dispose(): void } | null;
	session: {
		send(method: string): Promise<unknown>;
		detach(): Promise<unknown>;
		removeAllListeners?(): unknown;
	};
}

export async function releasePageCoverage(recorder: PageCoverageRecorder): Promise<void> {
	if (recorder.cleanupStarted) return;
	recorder.cleanupStarted = true;
	recorder.active = false;
	const { session } = recorder;
	const actions: CoverageCleanup[] = [
		() => recorder.pageOperationCheckpoints?.dispose(),
		() => recorder.navigationCheckpoints?.dispose(),
		() => session.send('Profiler.stopPreciseCoverage'),
		() => session.send('Profiler.disable'),
		() => session.send('Debugger.disable'),
		() => session.detach(),
		() => session.removeAllListeners?.(),
	];
	await cleanupCoverage(actions.map(action => async () => {
		try { await action(); } catch (error) { if (!recorder.page.isClosed()) throw error; }
	}));
}

type CoverageListener = (...arguments_: unknown[]) => void;
interface CoverageEventSession {
	on(event: string, listener: CoverageListener): unknown;
	off(event: string, listener: CoverageListener): unknown;
}

/** Playwright owns the target; remove only the listeners this collector added. */
export function ownCoverageSessionListeners(session: CoverageEventSession) {
	const listeners: { event: string; listener: CoverageListener }[] = [];
	return {
		on(event: string, listener: CoverageListener): void {
			listeners.push({ event, listener });
			session.on(event, listener);
		},
		off(event: string, listener: CoverageListener): void {
			const index = listeners.findIndex(owned => owned.event === event && owned.listener === listener);
			if (index === -1) return;
			listeners.splice(index, 1);
			session.off(event, listener);
		},
		close(): void {
			for (const { event, listener } of listeners.splice(0)) session.off(event, listener);
		},
	};
}
