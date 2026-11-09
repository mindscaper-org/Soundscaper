/* SPDX-License-Identifier: AGPL-3.0-only */

interface CountdownOptions<Handle> {
	readonly duration: number;
	now(): number;
	schedule(callback: () => void, delay: number): Handle;
	cancel(handle: Handle): void;
	onExpire(): void;
}

/** Pause the reading budget without restarting it; disposal is idempotent. */
export function createToastCountdown<Handle>({ duration, now, schedule, cancel, onExpire }: CountdownOptions<Handle>) {
	let remaining = duration;
	let started = now();
	let paused = false;
	let finished = false;
	let handle: Handle | undefined;
	const stop = () => { if (handle !== undefined) cancel(handle); handle = undefined; };
	const start = () => {
		started = now();
		handle = schedule(() => {
			if (finished || paused) return;
			finished = true;
			handle = undefined;
			onExpire();
		}, remaining);
	};
	start();
	return {
		setPaused(next: boolean) {
			if (finished || paused === next) return;
			paused = next;
			if (paused) { remaining = Math.max(0, remaining - (now() - started)); stop(); }
			else start();
		},
		dispose() { finished = true; stop(); },
	};
}
