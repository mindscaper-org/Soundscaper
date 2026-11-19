/* SPDX-License-Identifier: AGPL-3.0-only */

import { takeEarlyApplicationInstallPrompt } from './install-prompt-preload.ts';

/**
 * The event a Chromium browser fires once a document meets its installability
 * criteria. It is not in the DOM lib, and it is deliberately described here by
 * the two members this module uses rather than by a full ambient declaration:
 * a browser that fires something else shaped differently is simply ignored.
 */
export interface InstallPromptEvent {
	preventDefault(): void;
	prompt(): unknown;
	readonly userChoice?: PromiseLike<{ readonly outcome: string }>;
}

/** The window-shaped surface the capture listens on. */
export interface InstallPromptEventSource {
	addEventListener(type: string, listener: (event: unknown) => void): void;
	removeEventListener(type: string, listener: (event: unknown) => void): void;
}

export type InstallPromptOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface InstallPromptCapture {
	/** Whether an unspent prompt is held right now. */
	available(): boolean;
	subscribe(listener: () => void): () => void;
	/** Replays the held prompt from a user gesture and spends it. */
	prompt(): Promise<InstallPromptOutcome>;
	/** Detaches the listeners and drops any held prompt. */
	stop(): void;
}

export interface CreateInstallPromptCaptureOptions {
	readonly source?: InstallPromptEventSource | null;
	readonly onChange?: (available: boolean) => void;
	readonly initialOffer?: unknown;
}

/**
 * Holds the browser's install offer until the editor asks for it.
 *
 * The browser fires `beforeinstallprompt` at a moment of its own choosing and
 * withdraws its own banner when the page calls `preventDefault`, so the offer
 * has to be kept somewhere the Help menu can reach later. The prompt may be
 * shown once per event, which is why replaying it drops the event first: a
 * second menu click must find nothing rather than replay an event the browser
 * has already consumed.
 */
export function createInstallPromptCapture(
	options: CreateInstallPromptCaptureOptions = {},
): InstallPromptCapture {
	const source = options.source === undefined
		? (globalThis as unknown as InstallPromptEventSource)
		: options.source;
	let captured = isInstallPromptEvent(options.initialOffer) ? options.initialOffer : null;
	const listeners = new Set<() => void>();
	if (options.onChange) listeners.add(() => { options.onChange?.(captured !== null); });
	const announce = () => {
		for (const listener of [...listeners]) {
			try { listener(); } catch {
				// Availability observers are advisory and cannot own the capture lifecycle.
			}
		}
	};
	const capture = (event: unknown) => {
		if (!isInstallPromptEvent(event)) return;
		event.preventDefault();
		captured = event;
		announce();
	};
	const discard = () => {
		if (captured === null) return;
		captured = null;
		announce();
	};
	const listening = typeof source?.addEventListener === 'function'
		&& typeof source?.removeEventListener === 'function';
	if (listening) {
		source?.addEventListener('beforeinstallprompt', capture);
		source?.addEventListener('appinstalled', discard);
	}
	return Object.freeze({
		available: () => captured !== null,
		subscribe(listener: () => void) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
		prompt: async (): Promise<InstallPromptOutcome> => {
			const event = captured;
			if (event === null) return 'unavailable';
			discard();
			await event.prompt();
			const choice = await event.userChoice;
			return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
		},
		stop: () => {
			discard();
			listeners.clear();
			if (!listening) return;
			source?.removeEventListener('beforeinstallprompt', capture);
			source?.removeEventListener('appinstalled', discard);
		},
	});
}

let sharedCapture: InstallPromptCapture | null = null;

/**
 * The one capture the running editor shares.
 *
 * The browser entry attaches the listeners before loading the editor. The menu
 * can use the same capture when its workspace becomes ready.
 */
export function applicationInstallPromptCapture(): InstallPromptCapture {
	sharedCapture ??= createInstallPromptCapture({ initialOffer: takeEarlyApplicationInstallPrompt() });
	return sharedCapture;
}

/** Drops the shared capture so a test can observe a fresh one. */
export function resetApplicationInstallPromptCapture(): void {
	sharedCapture?.stop();
	sharedCapture = null;
}

function isInstallPromptEvent(value: unknown): value is InstallPromptEvent {
	if (value === null || typeof value !== 'object') return false;
	const candidate = value as Partial<InstallPromptEvent>;
	return typeof candidate.prompt === 'function' && typeof candidate.preventDefault === 'function';
}
