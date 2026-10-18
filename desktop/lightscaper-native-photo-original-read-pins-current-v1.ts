/* SPDX-License-Identifier: AGPL-3.0-only */

import { realpathSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

type Entry = { owners: number; reads: number; count: number; pins: Map<string, Map<string, number>> };
const entries = new Map<string, Entry>();
export interface LightscaperNativePhotoOriginalReadReservationCurrentV1 { release(): void }
type Reservation = { key: string; entry: Entry; held: boolean; used: boolean; released: boolean; retired: boolean; settle(): void; done: Promise<void> };
const reservations = new WeakMap<object, Reservation>();
export interface LightscaperNativePhotoOriginalGroupReservationCurrentV1 { release(): void; quarantine(error: unknown): void }
type Group = { owner: object; key: string; entry: Entry; count: number; active: number; claimed: Set<number>;
	released: boolean; retired: boolean; used: boolean; failed: boolean; done: Promise<void>; settle(): void; refuse(error: unknown): void };
const groups = new WeakMap<object, Group>();
function settleGroup(value: Group): void {
	if (value.released && !value.active && !value.retired && !value.failed) { value.retired = true; value.entry.count -= value.count; value.settle(); prune(value.key, value.entry); }
}
/** Activation is explicit: an accepted group may be waiting for its first
 * genuine authority lookup while it has no claimed physical pins yet. */
export function activateLightscaperNativePhotoOriginalGroupReservationCurrentV1(value: unknown): void {
	const group = value && typeof value === 'object' ? groups.get(value) : undefined;
	if (!group || group.released || group.retired || group.used || group.failed) throw new Error('Native Original group requires its unused genuine booking.');
	group.used = true;
}
function groupFor(value: unknown, owner: object, index: number): Group {
	const group = value && typeof value === 'object' ? groups.get(value) : undefined;
	if (!group || group.owner !== owner || group.released || !group.used || group.failed || !Number.isSafeInteger(index) || Object.is(index, -0)
		|| index < 0 || index >= group.count || group.claimed.has(index)) throw new Error('Native Original group requires its genuine unused owner-bound slot.');
	return group;
}
function settleReservation(value: Reservation): void {
	if (value.released && !value.held && !value.retired) { value.retired = true; value.entry.reads--; value.settle(); prune(value.key, value.entry); }
}
export function activateLightscaperNativePhotoOriginalReadReservationCurrentV1(value: unknown): void {
	const reservation = value && typeof value === 'object' ? reservations.get(value) : undefined;
	if (!reservation || reservation.released || reservation.used) throw new Error('Native Original admission requires its unused genuine reservation.');
	reservation.used = true;
}
export function holdLightscaperNativePhotoOriginalReadReservationCurrentV1(database: DatabaseSync, value: unknown): Readonly<{ retire(): void }> {
	const reservation = value && typeof value === 'object' ? reservations.get(value) : undefined;
	if (!reservation || reservation.key !== namespace(database) || reservation.released || !reservation.used || reservation.held) throw new Error('Native Original requires its genuine active read reservation.');
	reservation.held = true; let retired = false;
	return Object.freeze({ retire(): void { if (!retired) { retired = true; reservation.held = false; settleReservation(reservation); } } });
}
function namespace(database: DatabaseSync): string {
	const file = database.prepare('PRAGMA database_list').get()?.file;
	if (typeof file !== 'string' || !file) throw new Error('Native Original reads require a real file-backed media namespace.');
	const path = realpathSync.native(file); return process.platform === 'win32' ? path.toLowerCase() : path;
}
function prune(key: string, entry: Entry): void { if (!entry.owners && !entry.reads && !entry.count) entries.delete(key); }
export function assertLightscaperNativePhotoOriginalUnpinnedCurrentV1(database: DatabaseSync, assetId: string): void {
	if (entries.get(namespace(database))?.pins.has(assetId)) throw new Error('Native Original is pinned by a live consumer.');
}
/** Only actual Media constructors register their verified SQLite connection.
	* Entries disappear after their last owner, scalar pin and bounded pull retire. */
export function registerLightscaperNativePhotoOriginalPinsCurrentV1(database: DatabaseSync) {
	const key = namespace(database), entry = entries.get(key) ?? { owners: 0, reads: 0, count: 0, pins: new Map<string, Map<string, number>>() };
	entries.set(key, entry); entry.owners++; let closed = false, closing: Promise<void> | null = null;
	const owned = new Set<Reservation>(), grouped = new Set<Group>(), owner = Object.freeze({});
	const check = (): void => { if (closed) throw new Error('Native Original pin owner is closed.'); };
	const pin = (assetId: string, token: string, group?: Group): Readonly<{ release(): void }> => {
		const generations = entry.pins.get(assetId) ?? new Map<string, number>();
		entry.pins.set(assetId, generations); generations.set(token, (generations.get(token) ?? 0) + 1);
		if (group) group.active++; else entry.count++; let released = false;
		return Object.freeze({ release(): void {
			if (released) return; released = true; const next = (generations.get(token) ?? 1) - 1;
			if (next) generations.set(token, next); else generations.delete(token);
			if (!generations.size) entry.pins.delete(assetId);
			if (group) { group.active--; settleGroup(group); } else entry.count--;
			prune(key, entry);
		} });
	};
	return Object.freeze({
		reserveGroup(count: number): Readonly<LightscaperNativePhotoOriginalGroupReservationCurrentV1> {
			check(); if (!Number.isSafeInteger(count) || count < 0 || count > 4094 || Object.is(count, -0)) throw new RangeError('Native Original group count is invalid.');
			if (count > 4094 - entry.count) throw new Error('The native Original consumer capacity is busy.');
			entry.count += count; let settle!: () => void, refuse!: (error: unknown) => void;
			const done = new Promise<void>((resolve, reject) => { settle = resolve; refuse = reject; }); void done.catch(() => undefined);
			const state: Group = { owner, key, entry, count, active: 0, claimed: new Set(), released: false, retired: false, used: false, failed: false, done,
				settle: () => { grouped.delete(state); settle(); }, refuse }; if (count) grouped.add(state);
			const packet = Object.freeze({ release(): void { state.released = true; settleGroup(state); }, quarantine(error: unknown): void {
				if (state.failed) return;
				if (state.retired) throw new Error('A retired native Original booking cannot be quarantined.');
				state.failed = true; state.released = true; grouped.add(state); state.refuse(error);
			} }); groups.set(packet, state); return packet;
		},
		assertGroup(value: unknown, index: number): void { check(); groupFor(value, owner, index); },
		pinGroup(assetId: string, token: string, value: unknown, index: number): Readonly<{ release(): void }> {
			check(); const group = groupFor(value, owner, index); group.claimed.add(index); return pin(assetId, token, group);
		},
		reserve(): Readonly<LightscaperNativePhotoOriginalReadReservationCurrentV1> {
			check(); if (entry.reads >= 4) throw new Error('The native Original read capacity is busy.'); entry.reads++;
			let settle!: () => void; const done = new Promise<void>(resolve => { settle = resolve; });
			const state: Reservation = { key, entry, held: false, used: false, released: false, retired: false, done, settle: () => { owned.delete(state); settle(); } };
			owned.add(state);
			const packet = Object.freeze({ release(): void { state.released = true; settleReservation(state); } });
			reservations.set(packet, state); return packet;
		},
		pin(assetId: string, token: string): Readonly<{ release(): void }> {
			check(); if (entry.count >= 4094) throw new Error('The native Original consumer capacity is busy.');
			return pin(assetId, token);
		},
		close(): Promise<void> {
			if (closing) return closing; closed = true; const accepted = [...owned], acceptedGroups = [...grouped];
			closing = Promise.all([...accepted.map(value => value.done), ...acceptedGroups.map(value => value.done)]).then(() => { entry.owners--; prune(key, entry); });
			for (const value of accepted) if (!value.used) { value.released = true; settleReservation(value); }
			for (const value of acceptedGroups) if (!value.used && !value.failed) { value.released = true; settleGroup(value); }
			return closing;
		},
	});
}
