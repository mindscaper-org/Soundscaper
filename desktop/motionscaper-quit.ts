/* SPDX-License-Identifier: AGPL-3.0-only */
interface MotionQuitEvent { preventDefault(): void }
interface MotionQuitOptions {
	readonly disposeLaunches?: () => void | Promise<void>;
	readonly disposeFiles: () => void | Promise<void>;
	readonly disposeDelivery: () => void | Promise<void>;
	readonly quit: () => void;
	readonly reportFailure: (error: unknown) => void;
}

/** Retains the native authorities until an intentional desktop quit. */
export class MotionDesktopQuitOwner {
	#completion: Promise<void> | null = null;
	#released = false;
	constructor(readonly options: MotionQuitOptions) {}
	beforeQuit(event: MotionQuitEvent): Promise<void> {
		if (this.#released) return Promise.resolve();
		event.preventDefault();
		// Publish the single barrier before invoking callbacks which may request quit again.
		this.#completion ??= Promise.resolve().then(() => this.#clean());
		return this.#completion;
	}
	async #clean(): Promise<void> {
		const attempt = async (dispose: () => void | Promise<void>): Promise<unknown[]> => {
			try { await dispose(); return []; } catch (error) { return [error]; }
		};
		const [files, delivery] = await Promise.all([
			(async () => {
				const failures = this.options.disposeLaunches ? await attempt(this.options.disposeLaunches) : [];
				return [...failures, ...await attempt(this.options.disposeFiles)];
			})(),
			attempt(this.options.disposeDelivery),
		]);
		const failures = [...files, ...delivery];
		if (failures.length) {
			this.#report(new AggregateError(failures, 'Native desktop cleanup failed; application quit remains held.'));
			return;
		}
		this.#released = true;
		try { this.options.quit(); }
		catch (error) { this.#released = false; this.#report(error); }
	}
	#report(error: unknown): void {
		try { this.options.reportFailure(error); }
		catch (reportingError) { console.error(new AggregateError([error, reportingError], 'Native desktop cleanup failure could not be displayed.')); }
	}
}
