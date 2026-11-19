/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import type { LightscaperNativePhotoSessionLeaseCurrentV1 as Lease } from '../../desktop/lightscaper-native-photo-session-lease-current-v1.ts';
import { deferred, remainsPending } from './async-test-control.ts';
export { assert, remainsPending };
export const EXCLUSIVE_OPTIONS_CURRENT_V1 = { timeout: 15_000, concurrency: false };
export async function nativeSessionExclusiveFixtureCurrentV1(context: TestContext, run: (fixture: Readonly<{
	lease: Readonly<Lease>; appDataPath: string; signal: AbortSignal;
	track<T>(work: Promise<T>): Promise<T>; gate(): Readonly<{ entered: Promise<void>; enter(): void; wait: Promise<void>; release(): void }>;
	reopen(): Promise<Readonly<Lease>>;
}>) => Promise<void>): Promise<void> {
	const controller = new AbortController(), releases = new Set<() => void>(), active = new Set<Promise<unknown>>();
	const leases = new Set<Readonly<Lease>>(), managers = new Set<Scopes>(); let directory: string | undefined, failed = false, primary: unknown;
	const cancel = (): void => { controller.abort(context.signal.reason); for (const release of releases) release(); for (const lease of leases) lease.stop(); };
	context.signal.addEventListener('abort', cancel, { once: true });
	const track = <T>(work: Promise<T>): Promise<T> => { active.add(work); void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work; };
	const open = async (): Promise<Readonly<Lease>> => {
	 assert.ok(directory); const manager = await Scopes.open({ appDataPath: directory }); managers.add(manager);
	 const selected = await manager.openSelected({ name: 'Exclusive fixture', signal: controller.signal });
	 const method: unknown = Reflect.get(manager, 'openSessionLease'); assert.equal(typeof method, 'function', 'actual selected native Session lease must exist');
	 const local = Object.freeze({ close: (): Promise<void> => Promise.resolve() });
	 const lease = await Reflect.apply(method as (...args: unknown[]) => Promise<Readonly<Lease>>, manager, [selected.scope, local, { signal: controller.signal }]);
	 leases.add(lease); return lease;
	};
	try {
	 directory = await mkdtemp(join(tmpdir(), 'lightscaper-session-exclusive-')); const lease = await open();
	 if (context.signal.aborted) cancel(); context.signal.throwIfAborted();
	 await run({ lease, appDataPath: directory, signal: controller.signal, track,
	  gate: () => {
	   const entered = deferred<void>(), released = deferred<void>();
	   const release = (): void => { entered.resolve(); released.resolve(); }; releases.add(release);
	   if (context.signal.aborted) release();
	   return Object.freeze({ entered: entered.promise, enter: (): void => { entered.resolve(); }, wait: released.promise, release });
	  },
	  reopen: async () => { for (const owner of leases) await owner.close(); for (const owner of managers) await owner.close(); return open(); },
	 });
	} catch (error) { failed = true; primary = error; }
	context.signal.removeEventListener('abort', cancel); for (const release of releases) release(); controller.abort(new Error('Exclusive fixture closing.'));
	for (const lease of leases) lease.stop(); await Promise.allSettled([...active]); const cleanup: unknown[] = [];
	for (const lease of leases) { try { await lease.close(); } catch (error) { cleanup.push(error); } }
	for (const manager of managers) { try { await manager.close(); } catch (error) { cleanup.push(error); } }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Exclusive fixture retained its native guard after unproved retirement.');
	if (directory) await rm(directory, { recursive: true, force: true }); if (failed) throw primary;
}
