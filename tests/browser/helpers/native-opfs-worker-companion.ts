/* SPDX-License-Identifier: AGPL-3.0-only */

import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';

const installed = new WeakMap<Page, Promise<void>>();
interface WorkerEnvironment { secure: boolean; isolated: boolean; kind: string; directory: string; handler: string; synchronousAccess: string }
type WorkerObservation = { environment: WorkerEnvironment } | { failure: unknown };
const observations = new WeakMap<Page, Array<Promise<WorkerObservation>>>();

/** Observe the real module execution context, so failed worker loading cannot
 * qualify merely because the repository's native file fallback still succeeds. */
export function watchNativeOpfsWorkerExecution(page: Page): void {
	if (observations.has(page)) return;
	const attempts: Array<Promise<WorkerObservation>> = []; observations.set(page, attempts);
	page.on('worker', worker => {
		if (!new URL(worker.url()).pathname.endsWith('/opfs-sync-worker.ts')) return;
		attempts.push(worker.evaluate(() => ({ secure: isSecureContext, isolated: crossOriginIsolated,
			kind: globalThis.constructor.name, directory: typeof navigator.storage.getDirectory,
			handler: typeof globalThis.onmessage, synchronousAccess: typeof Reflect.get(FileSystemFileHandle.prototype, 'createSyncAccessHandle') }))
			.then(environment => ({ environment }), (failure: unknown) => ({ failure })));
	});
}

export async function assertNativeOpfsWorkerExecution(page: Page): Promise<void> {
	const attempts = observations.get(page);
	if (!attempts?.length) throw new Error('The actual OPFS worker companion has not executed.');
	for (const attempt of await Promise.all(attempts)) {
		if ('failure' in attempt) throw new Error('The actual OPFS worker companion failed to execute.', { cause: attempt.failure });
		const value = attempt.environment;
		if (!value.secure || !value.isolated || value.kind !== 'DedicatedWorkerGlobalScope'
			|| value.directory !== 'function' || value.handler !== 'function' || value.synchronousAccess !== 'function') {
			throw new Error(`The actual OPFS worker companion lacks its native execution environment: ${JSON.stringify(value)}`);
		}
	}
}

interface SnapshotWorkerLifetime {
	readonly id: number;
	readonly snapshotRequests: number;
	readonly terminated: boolean;
	readonly joinedBeforeTermination: boolean;
}

/** Record real snapshot workers' observation/termination order without delaying
 * native requests or accepting a checkpoint after its worker has already closed. */
export async function observeNativeOpfsSnapshotWorkerLifetimes(page: Page): Promise<{
	read(): Promise<readonly SnapshotWorkerLifetime[]>;
	restore(): Promise<void>;
}> {
	const observer = await page.evaluateHandle(() => {
		const scope = globalThis as typeof globalThis & { __assertNativeOpfsWorkerExecution?: () => Promise<void> };
		const companion = scope.__assertNativeOpfsWorkerExecution;
		const companionDescriptor = Object.getOwnPropertyDescriptor(scope, '__assertNativeOpfsWorkerExecution');
		const postDescriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'postMessage');
		const terminateDescriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'terminate');
		if (typeof companion !== 'function' || !companionDescriptor || !postDescriptor || !terminateDescriptor) {
			throw new Error('The actual worker and native companion must exist before lifecycle observation.');
		}
		const post = Worker.prototype.postMessage, terminate = Worker.prototype.terminate;
		const workers = new Map<Worker, { id: number; snapshots: number; joined: number; terminated: boolean; joinedAtTermination: boolean }>();
		Object.defineProperty(Worker.prototype, 'postMessage', { ...postDescriptor, value: function(this: Worker, ...args: Parameters<Worker['postMessage']>) {
			Reflect.apply(post, this, args);
			const message: unknown = args[0];
			if (message === null || typeof message !== 'object') return;
			const request = message as { type?: unknown; operationId?: unknown };
			if (request.type !== 'snapshot' || request.operationId !== 'media-asset-chunk-read') return;
			let worker = workers.get(this);
			if (!worker) {
				worker = { id: workers.size + 1, snapshots: 0, joined: 0, terminated: false, joinedAtTermination: false };
				workers.set(this, worker);
			}
			worker.snapshots++;
		} });
		Object.defineProperty(Worker.prototype, 'terminate', { ...terminateDescriptor, value: function(this: Worker) {
			const worker = workers.get(this), joined = worker !== undefined && worker.joined === worker.snapshots;
			Reflect.apply(terminate, this, []);
			if (worker) { worker.terminated = true; worker.joinedAtTermination = joined; }
		} });
		Object.defineProperty(scope, '__assertNativeOpfsWorkerExecution', { ...companionDescriptor, value: async () => {
			const live = [...workers.values()].filter(worker => !worker.terminated).map(worker => ({ worker, snapshots: worker.snapshots }));
			await Reflect.apply(companion, scope, []);
			for (const { worker, snapshots } of live) if (!worker.terminated) worker.joined = Math.max(worker.joined, snapshots);
		} });
		return {
			read: () => [...workers.values()].map(worker => ({ id: worker.id, snapshotRequests: worker.snapshots,
				terminated: worker.terminated, joinedBeforeTermination: worker.joinedAtTermination })),
			restore() {
				Object.defineProperty(scope, '__assertNativeOpfsWorkerExecution', companionDescriptor);
				Object.defineProperty(Worker.prototype, 'postMessage', postDescriptor);
				Object.defineProperty(Worker.prototype, 'terminate', terminateDescriptor);
			},
		};
	});
	return {
		read: () => observer.evaluate(value => value.read()),
		async restore() { try { await observer.evaluate(value => value.restore()); } finally { await observer.dispose(); } },
	};
}

/** Esbuild preserves the common client's worker URL; supply its actual companion
 * with the same response policy the production preview serves at that URL. */
export function installNativeOpfsWorkerCompanion(page: Page): Promise<void> {
	watchNativeOpfsWorkerExecution(page);
	const prior = installed.get(page); if (prior) return prior;
	const ready = install(page); installed.set(page, ready); return ready;
}

async function install(page: Page): Promise<void> {
	await page.exposeFunction('__assertNativeOpfsWorkerExecution', () => assertNativeOpfsWorkerExecution(page));
	const worker = await build({ entryPoints: [fileURLToPath(new URL('../../../src/common/editor/storage/opfs-sync-worker.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser' });
	const body = worker.outputFiles[0]?.text;
	if (worker.outputFiles.length !== 1 || typeof body !== 'string') throw new Error('Expected one actual OPFS worker companion.');
	await page.route('**/opfs-sync-worker.ts', async route => {
		const response = await route.fetch();
		const headers = response.headers(); delete headers['content-length']; delete headers['content-encoding'];
		headers['content-type'] = 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body }); }
		finally { await response.dispose(); }
	});
}
