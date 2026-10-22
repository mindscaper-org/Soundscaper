/* SPDX-License-Identifier: AGPL-3.0-only */

export interface LightscaperDesktopCloseResponse {
	readonly requestId: string;
	readonly allow: boolean;
}
export interface LightscaperDesktopLifecycleBridge {
	signalReady(): void | Promise<void>;
	onCloseRequested(listener: (request: unknown) => void): () => void;
	respondToClose(response: Readonly<LightscaperDesktopCloseResponse>): void | Promise<void>;
}
export type LightscaperDesktopCloseSafety = 'ready' | 'busy' | 'open-surface';
export interface LightscaperDesktopLifecycleOptions {
	readonly bridge: LightscaperDesktopLifecycleBridge;
	readonly isMounted: () => boolean;
	readonly closeSafety: () => LightscaperDesktopCloseSafety;
	/** Fence admission synchronously, before the first asynchronous retirement. */
	readonly fence: () => void;
	readonly retireAndJoin: () => Promise<void>;
	readonly reportVeto: (reason: Exclude<LightscaperDesktopCloseSafety, 'ready'>) => void;
	readonly reportError: (error: unknown) => void;
}

/** One mounted renderer owns readiness, a close fence and its retirement ACK.
 * Open surfaces are vetoed without mutation: a Develop draft is never discarded
 * merely because the operating system requested a window close. */
export class LightscaperDesktopLifecycle {
	readonly #options: LightscaperDesktopLifecycleOptions;
	#live = false;
	#disposed = false;
	#unsubscribe: (() => void) | null = null;
	#mount: Promise<void> | null = null;
	#retirement: Promise<void> | null = null;
	#closing = false;
	readonly #requests = new Set<string>();
	readonly #pending = new Set<Promise<void>>();
	#disposal: Promise<void> | null = null;

	constructor(options: LightscaperDesktopLifecycleOptions) { this.#options = options; }

	mount(): Promise<void> {
		if (this.#mount) return this.#mount;
		if (this.#disposed) return Promise.resolve();
		let settle!: () => void;
		this.#mount = new Promise<void>(resolve => { settle = resolve; });
		this.#live = true;
		try {
			const unsubscribe = this.#options.bridge.onCloseRequested(request => { this.#request(request); });
			if (this.#disposed) unsubscribe(); else this.#unsubscribe = unsubscribe;
		} catch (error) {
			this.#live = false; this.#report(error);
			settle(); return this.#mount;
		}
		// React's StrictMode effect probe disposes its first owner before this
		// microtask. Only a still-mounted application may tell main it is ready.
		void Promise.resolve().then(async () => {
			if (this.#live && this.#options.isMounted()) await this.#options.bridge.signalReady();
		}).then(settle, (error: unknown) => { this.#report(error); settle(); });
		return this.#mount;
	}

	isClosing(): boolean { return this.#closing; }

	dispose(): Promise<void> {
		if (this.#disposal) return this.#disposal;
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#disposal = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		void this.#disposal.catch(() => undefined);
		this.#disposed = true; this.#live = false;
		const unsubscribe = this.#unsubscribe; this.#unsubscribe = null;
		const errors: unknown[] = [];
		try { unsubscribe?.(); } catch (error) { errors.push(error); this.#report(error); }
		// A detached renderer may not ACK a later delivery. Its already admitted
		// retirement still has to settle before the lifecycle owner is released.
		void Promise.allSettled([...this.#pending, this.#mount]).then(async results => {
			for (const result of results) if (result.status === 'rejected') errors.push(result.reason as unknown);
			try { await this.#retirement; } catch (error) { errors.push(error); }
			if (errors.length === 1) throw errors[0];
			if (errors.length > 1) throw new AggregateError(errors, 'Lightscaper desktop lifecycle cleanup failed.');
		}).then(resolve, reject);
		return this.#disposal;
	}

	#request(value: unknown): void {
		if (!this.#live) return;
		const requestId = requestIdFrom(value);
		if (requestId === null || this.#requests.has(requestId)) return;
		this.#requests.add(requestId);
		// Install synchronous ownership before a bridge, observer or cancellation
		// callback can re-enter. No read/await is allowed between safety and fence.
		let resolve!: () => void, reject!: (error: unknown) => void;
		const operation = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
		this.#pending.add(operation);
		void this.#close(requestId).then(resolve, reject);
		void operation.then(() => { this.#pending.delete(operation); }, (error: unknown) => {
			this.#pending.delete(operation); this.#report(error);
		});
	}

	async #close(requestId: string): Promise<void> {
		let allow = false;
		try {
			if (!this.#closing) {
				const safety = this.#options.closeSafety();
				if (safety !== 'ready') {
					if (safety !== 'busy' && safety !== 'open-surface') throw new TypeError('Invalid Lightscaper close safety.');
					this.#options.reportVeto(safety);
				} else {
					this.#closing = true;
					let resolve!: () => void, reject!: (error: unknown) => void;
					this.#retirement = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
					void this.#retirement.catch(() => undefined);
					// Keep synchronous throws as a terminal failed retirement. A
					// partially retired generation must never be reopened by retry.
					try {
						this.#options.fence();
						void Promise.resolve(this.#options.retireAndJoin()).then(resolve, reject);
					} catch (error) { reject(error); }
				}
			}
			if (this.#retirement) { await this.#retirement; allow = true; }
		} catch (error) {
			if (this.#closing && this.#retirement === null) {
				this.#retirement = Promise.reject(error); void this.#retirement.catch(() => undefined);
			}
			this.#report(error);
		}
		if (this.#live) await this.#options.bridge.respondToClose(Object.freeze({ requestId, allow }));
	}

	#report(error: unknown): void {
		try { this.#options.reportError(error); } catch { /* A diagnostic observer cannot authorize closing. */ }
	}
}

function requestIdFrom(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	let fields: PropertyDescriptorMap;
	try {
		const prototype = Object.getPrototypeOf(value) as unknown;
		if (prototype !== Object.prototype && prototype !== null) return null;
		fields = Object.getOwnPropertyDescriptors(value);
	} catch { return null; }
	if (Reflect.ownKeys(fields).some(key => key !== 'requestId' && key !== 'reason')) return null;
	const id = fields.requestId, reason = fields.reason;
	if (!id?.enumerable || !Object.hasOwn(id, 'value') || typeof id.value !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(id.value)) return null;
	if (!reason?.enumerable || !Object.hasOwn(reason, 'value') || reason.value !== 'quit' && reason.value !== 'window-close') return null;
	return id.value as string;
}
