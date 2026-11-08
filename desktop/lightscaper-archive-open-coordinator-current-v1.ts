/* SPDX-License-Identifier: AGPL-3.0-only */

import { readDesktopLightscaperArchiveOpenDescriptorCurrentV1, readDesktopLightscaperArchiveOpenFinishCurrentV1,
	type DesktopLightscaperArchiveOpenDescriptorCurrentV1, type DesktopLightscaperArchiveOpenAvailabilityCurrentV1 } from '../src/common/editor/desktop-lightscaper-archive-open-contract-current-v1.ts';
import { LIGHTSCAPER_ARCHIVE_OPEN_MAXIMUM_PENDING_CURRENT_V1, lightscaperArchiveOpenPathKeyCurrentV1,
	normalizeLightscaperArchiveOpenNativePathCurrentV1 } from './lightscaper-archive-open-paths-current-v1.ts';

export interface LightscaperArchiveOpenPortsCurrentV1 {
	/** Compose registerSelectedReadCapability(store,path,{owner,purpose:'project'}).
	 * The existing native store owns admission rollback before rejecting. */
	readonly register: (path: string, owner: object) => Promise<unknown>;
	/** Existing store.release(id,{owner}) joins requests and handle retirement.
	 * false on our exact tracked ticket means it was already fully retired. */
	readonly release: (id: string, owner: object) => Promise<boolean>;
	readonly revokeOwner: (owner: object) => Promise<void>;
	readonly notify: (owner: object, event: Readonly<DesktopLightscaperArchiveOpenAvailabilityCurrentV1>) => void;
}
export type LightscaperArchiveEnqueueCurrentV1 = 'queued' | 'duplicate' | 'full' | 'invalid';
export interface LightscaperArchiveOpenCoordinatorCurrentV1 {
	enqueuePath(path: unknown): LightscaperArchiveEnqueueCurrentV1;
	replaceOwner(owner: object | null): Promise<void>;
	takeArchive(owner: object): Promise<Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null>;
	finishArchive(owner: object, value: unknown): Promise<void>;
	close(): Promise<void>;
}
interface Epoch {
	readonly owner: object;
	revocation: Promise<void> | null;
}
interface Delivery {
	readonly path: string;
	readonly epoch: Epoch;
	descriptor: Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null;
	registration: Promise<Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null>;
	finish: Promise<void> | null;
	acknowledged: boolean;
}

/** Bounded native-only path custody. A returned descriptor is outstanding until
 * finish joins its retirement; navigation requeues that unfinished delivery
 * after revocation. No path, picker choice or arbitrary read IPC is exposed. */
export function createLightscaperArchiveOpenCoordinatorCurrentV1(ports: LightscaperArchiveOpenPortsCurrentV1): Readonly<LightscaperArchiveOpenCoordinatorCurrentV1> {
	const paths: string[] = [], seenOwners = new WeakSet<object>();
	let current: Epoch | null = null, delivery: Delivery | null = null;
	let transition = Promise.resolve(), revision = 0, closed = false, fenced = false, failure: unknown;
	let closing: Promise<void> | null = null;

	function publish(): void {
		const epoch = current;
		if (!epoch) return;
		const event = Object.freeze({ available: !closed && !fenced && !delivery && paths.length > 0 });
		try { ports.notify(epoch.owner, event); }
		catch { /* Renderer destruction can race a wakeup; native queued custody remains. */ }
	}
	function fence(error: unknown): void {
		if (!fenced) failure = error;
		else if (failure !== error) failure = new AggregateError([failure, error], 'Archive operation and cleanup failed.');
		fenced = true; publish();
	}
	function revoke(epoch: Epoch): Promise<void> {
		if (epoch.revocation) return epoch.revocation;
		try { epoch.revocation = Promise.resolve(ports.revokeOwner(epoch.owner)); }
		catch (error) { epoch.revocation = Promise.reject(error); }
		return epoch.revocation;
	}
	function requeue(path: string): void {
		const key = lightscaperArchiveOpenPathKeyCurrentV1(path);
		if (!paths.some(value => lightscaperArchiveOpenPathKeyCurrentV1(value) === key)) paths.unshift(path);
	}
	function changeOwner(owner: object | null): Promise<void> {
		if (owner !== null && typeof owner !== 'object') return Promise.reject(new TypeError('Archive reader requires an opaque native owner.'));
		if (owner !== null && current?.owner === owner && !current.revocation && !fenced) { publish(); return transition; }
		if (owner !== null && seenOwners.has(owner)) return Promise.reject(new Error('A revoked archive reader owner cannot be reused.'));
		const generation = ++revision, previous = current, selected = delivery;
		current = null;
		const nativeRetirement = previous ? revoke(previous) : Promise.resolve();
		const prior = transition;
		const work = (async (): Promise<void> => {
			const results = await Promise.allSettled([prior, nativeRetirement,
				selected?.registration.catch(() => undefined), selected?.finish?.catch(() => undefined)]);
			const errors = results.slice(0, 2).flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
			if (errors.length) fence(errors.length === 1 ? errors[0] : new AggregateError(errors, 'Archive owner retirement failed.'));
			if (selected && delivery === selected) {
				if (!closed && !selected.acknowledged) requeue(selected.path);
				delivery = null;
			}
			if (fenced) throw failure;
			if (!closed && generation === revision && owner !== null) {
				current = { owner, revocation: null }; seenOwners.add(owner);
			}
			publish();
		})();
		transition = work;
		return work;
	}
	async function release(selected: Delivery): Promise<void> {
		if (!selected.descriptor) throw new Error('Archive reader has no issued descriptor.');
		const result = await ports.release(selected.descriptor.id, selected.epoch.owner);
		// Cancellation/error in the existing range protocol may already have
		// retired this exact ticket. Pending/failed cleanup remains a returned
		// promise/rejection in ReadCapabilityStore; absence is idempotent here.
		if (typeof result !== 'boolean') throw new TypeError('Archive native retirement returned an invalid acknowledgement.');
	}
	async function register(selected: Delivery): Promise<Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null> {
		let raw: unknown;
		try { raw = await ports.register(selected.path, selected.epoch.owner); }
		catch (error) {
			if (current === selected.epoch && !selected.epoch.revocation && !closed) {
				if (delivery === selected) delivery = null;
				publish(); throw error;
			}
			// Native owner revocation independently joins the real store's
			// admission and its rollback; the replacement owns requeueing.
			return null;
		}
		try { selected.descriptor = readDesktopLightscaperArchiveOpenDescriptorCurrentV1(raw); }
		catch (error) {
			fence(error);
			try { await revoke(selected.epoch); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Archive descriptor admission and revocation failed.', { cause: cleanup }); }
			throw error;
		}
		if (current !== selected.epoch || selected.epoch.revocation || closed) {
			try { await release(selected); }
			catch (error) { fence(error); throw error; }
			return null;
		}
		return selected.descriptor;
	}
	return Object.freeze({
		enqueuePath(value: unknown): LightscaperArchiveEnqueueCurrentV1 {
			const path = normalizeLightscaperArchiveOpenNativePathCurrentV1(value);
			if (closed || !path) return 'invalid';
			const key = lightscaperArchiveOpenPathKeyCurrentV1(path);
			if (paths.some(value => lightscaperArchiveOpenPathKeyCurrentV1(value) === key)
				|| (delivery && lightscaperArchiveOpenPathKeyCurrentV1(delivery.path) === key)) return 'duplicate';
			if (paths.length + (delivery ? 1 : 0) >= LIGHTSCAPER_ARCHIVE_OPEN_MAXIMUM_PENDING_CURRENT_V1) return 'full';
			paths.push(path); publish(); return 'queued';
		},
		replaceOwner(owner: object | null): Promise<void> {
			if (closed && owner !== null) return Promise.reject(new Error('Archive native queue is closed.'));
			return changeOwner(owner);
		},
		takeArchive(owner: object): Promise<Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1> | null> {
			if (fenced) return Promise.reject(failure);
			if (closed || !current || current.owner !== owner || delivery || paths.length === 0) return Promise.resolve(null);
			const selected: Delivery = { path: paths.shift()!, epoch: current, descriptor: null,
				registration: Promise.resolve(null), finish: null, acknowledged: false };
			delivery = selected; publish();
			selected.registration = register(selected);
			return selected.registration;
		},
		finishArchive(owner: object, value: unknown): Promise<void> {
			let id: string;
			try { id = readDesktopLightscaperArchiveOpenFinishCurrentV1(value).id; }
			catch (error) { return Promise.reject(error); }
			const selected = delivery;
			if (!selected?.descriptor || selected.descriptor.id !== id || selected.epoch.owner !== owner || current !== selected.epoch) {
				return Promise.reject(new Error('Archive finish is not owned by the current issued reader.'));
			}
			selected.finish ??= (async (): Promise<void> => {
				try { await release(selected); }
				catch (error) { fence(error); throw error; }
				if (current === selected.epoch && !selected.epoch.revocation && !closed) selected.acknowledged = true;
				if (delivery === selected && selected.acknowledged) { delivery = null; publish(); }
			})();
			return selected.finish;
		},
		close(): Promise<void> {
			if (closing) return closing;
			closed = true; paths.length = 0;
			closing = changeOwner(null);
			return closing;
		},
	});
}
