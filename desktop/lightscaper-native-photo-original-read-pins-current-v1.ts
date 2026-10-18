/* SPDX-License-Identifier: AGPL-3.0-only */

import { realpathSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

type Entry = { owners: number; reads: number; count: number; pins: Map<string, Map<string, number>> };
const entries = new Map<string, Entry>();
export interface LightscaperNativePhotoOriginalReadReservationCurrentV1 { release(): void }
type Reservation = { key: string; entry: Entry; held: boolean; used: boolean; released: boolean; retired: boolean; settle(): void; done: Promise<void> };
const reservations = new WeakMap<object, Reservation>();
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
	const owned = new Set<Reservation>();
	const check = (): void => { if (closed) throw new Error('Native Original pin owner is closed.'); };
	return Object.freeze({
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
			const generations = entry.pins.get(assetId) ?? new Map<string, number>();
			entry.pins.set(assetId, generations); generations.set(token, (generations.get(token) ?? 0) + 1); entry.count++; let released = false;
			return Object.freeze({ release(): void {
				if (released) return; released = true; const next = (generations.get(token) ?? 1) - 1;
				if (next) generations.set(token, next); else generations.delete(token);
				if (!generations.size) entry.pins.delete(assetId); entry.count--; prune(key, entry);
			} });
		},
		close(): Promise<void> {
			if (closing) return closing; closed = true; const accepted = [...owned];
			closing = Promise.all(accepted.map(value => value.done)).then(() => { entry.owners--; prune(key, entry); });
			for (const value of accepted) if (!value.used) { value.released = true; settleReservation(value); }
			return closing;
		},
	});
}
