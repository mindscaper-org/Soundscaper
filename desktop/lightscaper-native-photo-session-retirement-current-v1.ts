/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import { readDesktopPhotoSessionFailureCurrentV1 as failure, type DesktopPhotoSessionControlCurrentV1 as Control } from '../src/lightscaper/desktop-photo-session-response-current-v1.ts';

interface Entry {
	readonly openId: string;
	readonly retirementId: string;
	stopped: boolean;
	retired: boolean;
	closing?: Promise<void>;
	resolve?: () => void;
	reject?: (error: unknown) => void;
}

/** Main-private per-document owner. Only the installed preload completion or
 * the host's actual bound renderer-process exit may retire the local barrier.
 * Shell consent, navigation, cancellation and timers grant no such authority. */
export class LightscaperNativePhotoSessionRetirementCurrentV1 {
	readonly #send: (value: Readonly<Control>) => void;
	#entry: Entry | undefined;
	#exited = false;
	constructor(send: (value: Readonly<Control>) => void) { this.#send = send; }

	register(openId: string): Readonly<{ close(): Promise<void> }> {
		if (this.#exited) throw new Error('Native Session renderer process has exited.');
		if (!/^[a-f0-9]{64}$/u.test(openId)) throw new TypeError('Native Session opening requires a local correlation ID.');
		if (this.#entry && !this.#entry.retired) throw new Error('Native Session local ownership is occupied.');
		const entry: Entry = { openId, retirementId: randomBytes(32).toString('hex'), stopped: false, retired: false }; this.#entry = entry;
		return Object.freeze({ close: () => this.#close(entry) });
	}

	stop(): void {
		const entry = this.#entry; if (!entry || entry.stopped || entry.retired || this.#exited) return;
		entry.stopped = true; this.#send(Object.freeze({ schemaVersion: 1, kind: 'stop', openId: entry.openId, retirementId: entry.retirementId }));
	}

	respond(value: unknown): true {
		const entry = this.#entry;
		if (!entry?.closing || entry.retired || this.#exited) throw new Error('No native Session local retirement is pending.');
		const input = record(value, 'native Session local retirement', ['schemaVersion', 'openId', 'retirementId', 'outcome', 'error'], ['schemaVersion', 'openId', 'retirementId', 'outcome']);
		if (field(input, 'schemaVersion', 'native Session local retirement') !== 1 || field(input, 'openId', 'native Session local retirement') !== entry.openId
			|| field(input, 'retirementId', 'native Session local retirement') !== entry.retirementId) throw new Error('Native Session local retirement belongs to another opening.');
		const outcome = field(input, 'outcome', 'native Session local retirement');
		if (outcome === 'retired' && !Object.hasOwn(input, 'error')) { entry.retired = true; entry.resolve!(); return true; }
		if (outcome === 'failed' && Object.hasOwn(input, 'error')) { entry.reject!(failure(field(input, 'error', 'native Session local retirement'))); return true; }
		throw new TypeError('Invalid native Session local retirement outcome.');
	}

	/** Called only by the Electron host's actual render-process-gone listener,
	 * after revoking the exact process/frame/document owner and native work. */
	confirmProcessExit(): void {
		this.#exited = true;
		const entry = this.#entry; if (!entry) return;
		entry.retired = true; entry.resolve?.();
	}

	#close(entry: Entry): Promise<void> {
		if (entry.closing) return entry.closing;
		entry.closing = new Promise<void>((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
		if (this.#exited) { entry.retired = true; entry.resolve!(); return entry.closing; }
		entry.stopped = true;
		try { this.#send(Object.freeze({ schemaVersion: 1, kind: 'retire', openId: entry.openId, retirementId: entry.retirementId })); }
		catch (error) { entry.reject!(error); }
		return entry.closing;
	}
}
