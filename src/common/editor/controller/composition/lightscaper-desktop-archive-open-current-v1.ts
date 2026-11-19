/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	DesktopLightscaperArchiveOpenBridgeCurrentV1, DesktopLightscaperArchiveOpenDescriptorCurrentV1,
} from '../../desktop-lightscaper-archive-open-contract-current-v1.ts';

export interface LightscaperDesktopArchiveFileCurrentV1 {
	readonly file: File;
	close(): Promise<void>;
}
export interface LightscaperDesktopArchiveOpenOptionsCurrentV1 {
	readonly bridge: DesktopLightscaperArchiveOpenBridgeCurrentV1;
	readonly load: (descriptor: Readonly<DesktopLightscaperArchiveOpenDescriptorCurrentV1>, signal: AbortSignal) => Promise<Readonly<LightscaperDesktopArchiveFileCurrentV1>>;
	readonly canPresent: () => boolean;
	readonly onFile: (file: File | null) => void;
	readonly onPresent: () => void;
	readonly retireRestore: () => Promise<void>;
	readonly reportError: (error: unknown) => void;
	readonly onPendingChange?: () => void;
}
interface Stage {
	readonly resource: Readonly<LightscaperDesktopArchiveFileCurrentV1>;
	readonly consumers: Set<Promise<unknown>>;
	presented: boolean;
	dismissed: boolean;
	release: Promise<void> | null;
}
interface Loading { readonly stop: AbortController; readonly task: Promise<void> }

/** Availability is a wakeup, never authority to restore. One File is admitted
 * into the existing confirmation dialog and outlives every exact File consumer. */
export class LightscaperDesktopArchiveOpenCurrentV1 {
	readonly #options: LightscaperDesktopArchiveOpenOptionsCurrentV1;
	readonly #retiredFiles = new WeakSet<File>();
	#live = false;
	#closed = false;
	#scheduled = false;
	#available = true;
	#unsubscribe: (() => void) | null = null;
	#loading: Loading | null = null;
	#stage: Stage | null = null;
	#restoreRetirement: Promise<void> | null = null;
	#closing: Promise<void> | null = null;
	#pending = false;

	constructor(options: LightscaperDesktopArchiveOpenOptionsCurrentV1) { this.#options = options; }

	mount(): void {
		if (this.#closed || this.#live) return;
		this.#live = true;
		try {
			this.#unsubscribe = this.#options.bridge.onArchiveAvailable(() => {
				if (!this.#live || this.#closed) return;
				this.#available = true; this.tick();
			});
			this.tick();
		} catch (error) { this.#live = false; this.#report(error); }
	}

	/** The microtask fence prevents a StrictMode probe from taking native custody. */
	tick(): void {
		if (!this.#live || this.#closed || this.#scheduled) return;
		this.#scheduled = true;
		queueMicrotask(() => {
			this.#scheduled = false;
			if (!this.#live || this.#closed) return;
			try {
				if (this.#stage) { this.#present(this.#stage); return; }
				if (this.#loading || !this.#available || !this.#options.canPresent()) return;
				this.#available = false;
				const stop = new AbortController();
				const task = Promise.resolve().then(() => this.#load(stop.signal));
				const loading = { stop, task }; this.#loading = loading;
				void task.then(() => { this.#loaded(loading); }, error => {
					if (!this.#closed || !Object.is(error, stop.signal.reason)) this.#report(error);
					this.#loaded(loading);
				});
				this.#pendingChanged();
			} catch (error) { this.#report(error); }
		});
	}

	isPending(): boolean {
		const stage = this.#stage;
		return this.#loading !== null || stage !== null && (stage.consumers.size > 0 || stage.release !== null);
	}

	/** A borrowed manual File is untouched; exact staged File consumers latch
	 * before user code, so synchronous Close cannot delete their backing store. */
	withFileConsumer<Result>(file: File, consume: (file: File) => Promise<Result>): Promise<Result> {
		if (!this.#live || this.#closed || this.#retiredFiles.has(file)) return Promise.reject(retired());
		const stage = this.#stage;
		if (!stage || stage.resource.file !== file) return invoke(() => consume(file));
		if (!stage.presented || stage.dismissed) return Promise.reject(retired());
		let resolve!: (value: Result | PromiseLike<Result>) => void, reject!: (error: unknown) => void;
		const task = new Promise<Result>((accept, refuse) => { resolve = accept; reject = refuse; });
		stage.consumers.add(task);
		const settled = () => { stage.consumers.delete(task); this.#pendingChanged(); };
		void task.then(settled, settled);
		try { void Promise.resolve(consume(file)).then(resolve, reject); } catch (error) { reject(error); }
		this.#pendingChanged();
		return task;
	}

	/** Hiding never cancels restoration. Unpresented queued work is not dismissed
	 * when an unrelated/manual dialog closes during materialization. */
	dismiss(): Promise<void> {
		const stage = this.#stage;
		if (!stage?.presented) return Promise.resolve();
		stage.dismissed = true; this.#retiredFiles.add(stage.resource.file);
		return this.#release(stage);
	}

	/** Real unmount/desktop retirement joins the restore owner before deleting a
	 * presented File. A StrictMode probe has no presented File and retires none. */
	retireAndJoin(): Promise<void> {
		if (this.#closing) return this.#closing;
		let acceptClosing!: () => void, rejectClosing!: (error: unknown) => void;
		this.#closing = new Promise<void>((accept, refuse) => { acceptClosing = accept; rejectClosing = refuse; });
		this.#closed = true; this.#live = false;
		const loading = this.#loading, stage = this.#stage;
		try { this.#unsubscribe?.(); } catch (error) { this.#report(error); }
		this.#unsubscribe = null; loading?.stop.abort();
		let resolve!: () => void, reject!: (error: unknown) => void;
		this.#restoreRetirement = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
		void this.#restoreRetirement.catch(() => undefined);
		try {
			void Promise.resolve(stage?.presented ? this.#options.retireRestore() : undefined).then(resolve, reject);
		} catch (error) { reject(error); }
		if (stage) { stage.dismissed = true; this.#retiredFiles.add(stage.resource.file); }
		void (async () => {
			if (loading) {
				try { await loading.task; } catch (error) {
					if (!Object.is(error, loading.stop.signal.reason)) throw error;
				}
			}
			await this.#restoreRetirement;
			if (this.#stage) await this.#release(this.#stage);
		})().then(acceptClosing, rejectClosing);
		return this.#closing;
	}

	async #load(signal: AbortSignal): Promise<void> {
		if (this.#closed || signal.aborted) return;
		const descriptor = await this.#options.bridge.takeArchive();
		if (!descriptor) return;
		// The loader also retires an issued grant when this signal was aborted
		// while takeArchive was in flight, before it opens storage or readers.
		const resource = await this.#options.load(descriptor, signal);
		const stage: Stage = { resource, consumers: new Set(), presented: false, dismissed: this.#closed, release: null };
		this.#stage = stage;
		if (this.#closed) { this.#retiredFiles.add(resource.file); await this.#release(stage); }
		else this.#present(stage);
	}

	#loaded(loading: Loading): void { if (this.#loading === loading) this.#loading = null; this.#pendingChanged(); this.tick(); }
	#present(stage: Stage): void {
		if (!this.#live || this.#closed || stage.presented || stage.dismissed || !this.#options.canPresent()) return;
		stage.presented = true;
		this.#options.onFile(stage.resource.file); this.#options.onPresent();
	}
	#release(stage: Stage): Promise<void> {
		if (stage.release) return stage.release;
		stage.release = (async () => {
			await Promise.allSettled([...stage.consumers]);
			if (this.#restoreRetirement) await this.#restoreRetirement;
			await stage.resource.close();
			if (this.#stage === stage) {
				this.#stage = null;
				this.#pendingChanged();
				if (stage.presented && this.#live) this.#options.onFile(null);
				// A single wakeup can represent several argv/menu requests.
				this.#available = true; this.tick();
			}
		})();
		void stage.release.catch(error => { this.#report(error); });
		this.#pendingChanged();
		return stage.release;
	}
	#pendingChanged(): void {
		const pending = this.isPending();
		if (pending === this.#pending) return;
		this.#pending = pending;
		try { this.#options.onPendingChange?.(); } catch (error) { this.#report(error); }
	}
	#report(error: unknown): void { try { this.#options.reportError(error); } catch { /* Diagnostics cannot release custody. */ } }
}

function retired(): DOMException { return new DOMException('The desktop archive presentation is retired.', 'AbortError'); }
async function invoke<Result>(work: () => Promise<Result>): Promise<Result> { return await work(); }
