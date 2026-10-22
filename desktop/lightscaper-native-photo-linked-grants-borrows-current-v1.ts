/* SPDX-License-Identifier: AGPL-3.0-only */
import { registerLightscaperNativeOriginalPhysicalNamespaceCurrentV1 as register } from './lightscaper-native-original-physical-namespace-current-v1.ts';
import type { NativePath, NativeRoot, NativeFile } from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { readLightscaperNativePhotoGrantedFilesystemMissingCurrentV1 as missing,
	lightscaperNativePhotoGrantedFilesystemRetirementIsUnprovedCurrentV1 as unproved } from './lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { captureComponents } from './lightscaper-native-photo-granted-filesystem-codec-current-v1.ts';
import { linkedGrantIdCurrentV1 as id, type LinkedGrantRowCurrentV1 as Row } from './lightscaper-native-photo-linked-grants-records-current-v1.ts';
import { createLinkedGrantCleanupFailureCurrentV1 as cleanup, combineLinkedGrantFailuresCurrentV1 as combine } from './lightscaper-native-photo-linked-grants-failures-current-v1.ts';
import { createLightscaperNativePhotoLinkedUnavailableCurrentV1 as unavailable } from './lightscaper-native-photo-linked-unavailable-current-v1.ts';
import { captureNativeFilesystemOptions, checkNativeFilesystemSignal as checkSignal } from './lightscaper-native-photo-granted-filesystem-signal-current-v1.ts';
export interface LinkedGrantFileCaptureCurrentV1 { readonly row: Row; readonly components: readonly NativePath[] }
export interface LinkedGrantFileCurrentV1 extends NativeFile { assertCurrent(): void }
type Entry = { readonly snapshot: LinkedGrantFileCaptureCurrentV1; readonly done: Promise<void>; settle(): void; refuse(error: unknown): void;
	readonly pin: Readonly<{release():void}>; stopped: boolean; opening: boolean; file?: NativeFile; root?: NativeRoot; close?: Promise<void>; active: Set<Promise<unknown>>; busy: boolean };
type Ports = Readonly<{ mediaPath: string; snapshot(id: string): Row; current(snapshot: LinkedGrantFileCaptureCurrentV1): void;
	open(path: NativePath, expected: Row['identity']): Promise<NativeRoot>; fail(error: unknown): void }>;
/** Bounded retained file custody is independent of the four short grant work
 * slots. Revocation fences first, then waits the actual caller-owned lease. */
export class LinkedGrantBorrowsCurrentV1 {
	readonly #ports: Ports; readonly #namespace: ReturnType<typeof register>; readonly #captures = new WeakSet<object>(); readonly #entries = new Set<Entry>();
	#closed = false; #opens = 0; #closing: Promise<void> | null = null;
	constructor(ports: Ports) { this.#ports = ports; this.#namespace=register(ports.mediaPath); }
	capture(grantId: unknown, components: unknown): Readonly<LinkedGrantFileCaptureCurrentV1> {
		if (this.#closed) throw new Error('Native grant file admission is closed.');
		const row = this.#ports.snapshot(id(grantId)), captured = Object.freeze({ row, components: captureComponents(components, false) });
		this.#ports.current(captured); this.#captures.add(captured); return captured;
	}
	open(snapshot: Readonly<LinkedGrantFileCaptureCurrentV1>): Promise<Readonly<LinkedGrantFileCurrentV1>> {
		if (this.#closed || !this.#captures.has(snapshot)) return Promise.reject(new Error('Native grant file requires its current captured owner.'));
		if (this.#entries.size >= 4094 || this.#opens >= 4) return Promise.reject(new Error('Native grant file capacity is busy.'));
		let settle!: () => void, refuse!: (reason: unknown) => void;
		const done = new Promise<void>((yes, no) => { settle = yes; refuse = no; }); void done.catch(() => undefined);
		let pin: Readonly<{release():void}>; try{pin=this.#namespace.pin();}catch(error){return Promise.reject(error);}
		const entry: Entry = { snapshot, done, settle, refuse, pin, stopped: false, opening: true, active: new Set(), busy: false };
		this.#entries.add(entry); this.#opens++;
		return this.#open(entry).finally(() => { this.#opens--; entry.opening = false; });
	}
	#check(entry: Entry): void {
		if (this.#closed || entry.stopped || entry.close) throw new Error('Native grant file is retiring.'); this.#ports.current(entry.snapshot);
	}
	async #open(entry: Entry): Promise<Readonly<LinkedGrantFileCurrentV1>> {
		try {
			this.#check(entry); entry.root = await this.#ports.open(entry.snapshot.row.path, entry.snapshot.row.identity); this.#check(entry);
			entry.file = await entry.root.openFile(entry.snapshot.components); this.#check(entry);
			await entry.root.close(); entry.root = undefined; this.#check(entry);
			const file = entry.file;
			return Object.freeze({ identity: file.identity, byteLength: file.byteLength, assertCurrent: () => { this.#check(entry); },
				read: (offset: number, length: number, options?: Readonly<{signal?: AbortSignal}>): Promise<Uint8Array> => {
					try { this.#check(entry); if (entry.busy) throw new Error('Native linked file pull is busy.'); } catch (error) { return Promise.reject(error); }
					entry.busy = true;
					let resolve!: (value: Uint8Array) => void, reject!: (reason: unknown) => void;
					const work = new Promise<Uint8Array>((yes,no) => { resolve=yes; reject=no; }); entry.active.add(work);
					void (async () => { const signal = captureNativeFilesystemOptions(options); checkSignal(signal); this.#check(entry);
						// Local cancellation never terminates the shared native FS process.
						const bytes = await file.read(offset, length);
						try { checkSignal(signal); this.#check(entry); return bytes; } catch (error) { bytes.fill(0); throw error; }
					})().then(resolve,reject);
					void work.then(() => { entry.active.delete(work); entry.busy = false; }, () => { entry.active.delete(work); entry.busy = false; }); return work;
				}, close: () => this.#close(entry) });
		} catch (primary) {
			let error: unknown = primary; const classification = missing(primary);
			try { await this.#close(entry); }
			catch (failure) { error = combine([primary, failure], 'Native linked file opening and retirement failed.'); if (unproved(failure)) this.#namespace.quarantine(this); this.#ports.fail(error); throw error; }
			if (unproved(primary)) { this.#namespace.quarantine(this); this.#ports.fail(primary); }
			throw classification ? unavailable(classification) : error;
		}
	}
	#close(entry: Entry): Promise<void> {
		if (entry.close) return entry.close; entry.stopped = true;
		let resolve!: () => void, reject!: (reason: unknown) => void; entry.close = new Promise<void>((yes,no) => { resolve=yes; reject=no; });
		void (async () => {
			await Promise.allSettled([...entry.active]); const failures: unknown[] = [];
			try { await entry.file?.close(); } catch (error) { failures.push(error); }
			try { await entry.root?.close(); } catch (error) { failures.push(error); }
			if (failures.length) { const failure = cleanup(failures, 'Native grant file retirement is unproved.'); this.#namespace.quarantine(this); this.#ports.fail(failure); throw failure; }
			entry.pin.release(); this.#entries.delete(entry);
		})().then(() => { entry.settle(); resolve(); }, (error: unknown) => { entry.refuse(error); reject(error); }); return entry.close;
	}
	async revoke(grantId: string): Promise<void> {
		const matching = [...this.#entries].filter(entry => entry.snapshot.row.grant.grantId === grantId);
		for (const entry of matching) entry.stopped = true;
		await Promise.all(matching.map(entry => entry.done));
	}
	close(): Promise<void> { if(this.#closing)return this.#closing; this.#closed = true; const entries = [...this.#entries]; for (const entry of entries) entry.stopped = true; this.#closing=Promise.all(entries.map(entry => entry.done)).then(() => {this.#namespace.retire();});return this.#closing; }
}
