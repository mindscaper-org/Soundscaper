/* SPDX-License-Identifier: AGPL-3.0-only */
import type { CreatePhotoLibrarySessionCurrentV1 } from '../../common/editor/photo-library-session-port-current-v1.ts';
import type { LightscaperPhotoBackendSwitchCurrentV1 as Backend } from '../../common/editor/controller/composition/lightscaper-photo-backend-switch-current-v1.ts';
import { captureDebugFilesCurrentV1, isDebugCleanupFailureCurrentV1, type DebugSoakReportCurrentV1, type DebugPhaseReceiptCurrentV1 } from './photo-library-debug-soak-contract-current-v1.ts';
export interface DebugSoakSnapshotCurrentV1 {
	readonly busy: boolean; readonly failedCleanup: boolean; readonly phase: Readonly<DebugPhaseReceiptCurrentV1> | null;
	readonly report: Readonly<DebugSoakReportCurrentV1> | null; readonly failed: boolean;
}
/** Uses the exact same full workspace fence as selected-backend management.
 * Ordinary joined cancellation permits remount; unknown cleanup cannot. */
export class PhotoLibraryDebugSoakOwnerCurrentV1 {
	readonly #backend: Backend; readonly #create: CreatePhotoLibrarySessionCurrentV1;
	readonly #listeners = new Set<() => void>();
	#snapshot: Readonly<DebugSoakSnapshotCurrentV1> = Object.freeze({ busy: false, failedCleanup: false, phase: null, report: null, failed: false });
	#active: { stop: AbortController; work: Promise<void> } | undefined; #closed = false; #closing: Promise<void> | undefined;
	constructor(backend: Backend, createSession: CreatePhotoLibrarySessionCurrentV1) {
		this.#backend = backend; this.#create = createSession;
	}
	readonly snapshot = (): Readonly<DebugSoakSnapshotCurrentV1> => this.#snapshot;
	readonly subscribe = (listener: () => void): (() => void) => { this.#listeners.add(listener); return () => { this.#listeners.delete(listener); }; };
	#update(patch: Partial<DebugSoakSnapshotCurrentV1>): void { this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch }); for (const listener of this.#listeners) listener(); }
	start(filesValue: readonly File[]): Promise<void> {
		if (this.#closed || this.#active || this.#snapshot.failedCleanup) return Promise.reject(new Error('Library diagnostic is unavailable or already running.'));
		let resolve!: () => void, reject!: (reason: unknown) => void;
		const work = new Promise<void>((yes, no) => { resolve = yes; reject = no; }), active = { stop: new AbortController(), work }; this.#active = active;
		let files: readonly File[]; try { files = captureDebugFilesCurrentV1(filesValue, 3); } catch (error) { this.#active = undefined; reject(error); return work; }
		this.#update({ busy: true, failed: false, phase: null, report: null });
		void (async () => {
			let failed = false, primary: unknown;
			try {
				const changed = await this.#backend.retireAndRun(async () => {
					try {
						active.stop.signal.throwIfAborted(); const runtime = await import('./photo-library-debug-soak-current-v1.ts'); active.stop.signal.throwIfAborted();
						const report = await runtime.runPhotoLibraryDebugSoakCurrentV1({ createSession: this.#create, files, iterations: 3,
							signal: active.stop.signal, onPhase: phase => { this.#update({ phase }); } }); this.#update({ report });
					} catch (error) { if (isDebugCleanupFailureCurrentV1(error)) throw error; failed = true; primary = error; }
				});
				if (!changed) throw new Error('Finish current photo work and close its dialogs before starting the diagnostic.');
				if (failed) throw primary;
				resolve();
			} catch (error) { this.#update({ failed: true, failedCleanup: isDebugCleanupFailureCurrentV1(error) }); reject(error); }
			finally { if (this.#active === active) this.#active = undefined; this.#update({ busy: false }); }
		})();
		return work;
	}
	stop(): void { this.#active?.stop.abort(new DOMException('Library diagnostic stopped.', 'AbortError')); }
	close(): Promise<void> {
		if (this.#closing) return this.#closing; this.#closed = true; this.stop();
		const work = this.#active?.work;
		this.#closing = (async () => { try { await work; } catch (error) { if (isDebugCleanupFailureCurrentV1(error)) throw error; } })(); return this.#closing;
	}
}
