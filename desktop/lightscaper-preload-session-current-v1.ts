/* SPDX-License-Identifier: AGPL-3.0-only */

import { DESKTOP_PHOTO_LIBRARY_SESSION_CHANNELS_CURRENT_V1 as CHANNELS } from '../src/lightscaper/desktop-photo-library-session-protocol-current-v1.ts';
import { DESKTOP_PHOTO_SESSION_CONTROL_CHANNELS_CURRENT_V1 as CONTROL, readDesktopPhotoSessionControlCurrentV1 as control,
	readDesktopPhotoSessionResponseCurrentV1 as response, captureDesktopPhotoSessionFailureCurrentV1 as failure } from '../src/lightscaper/desktop-photo-session-response-current-v1.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../src/common/editor/closed-domain-value.ts';
import type { LightscaperPreloadIpcCurrentV1 as Ipc } from './lightscaper-preload-bridge-current-v1.ts';

export interface LightscaperPreloadSessionCurrentV1 {
	invoke(channel: string, payload: unknown): Promise<unknown>;
	installRetirement(openId: string, handler: (kind: 'stop' | 'retire') => Promise<void>): () => void;
}
interface Entry {
	readonly openId: string;
	readonly handler: (kind: 'stop' | 'retire') => Promise<void>;
	retirementId?: string;
	work?: Promise<void>;
	ack?: Promise<unknown>;
	detached: boolean;
	settled: boolean;
}

/** The owning preload dispatches actual local close and derives completion
 * inside the isolated world. No general renderer retirement-response API or
 * arbitrary IPC channel is exposed through the context bridge. */
export function createLightscaperPreloadSessionCurrentV1(ipc: Ipc): Readonly<LightscaperPreloadSessionCurrentV1> {
	let current: Entry | undefined;
	const allowed = new Set<string>(Object.values(CHANNELS));
	const listener = (_event: unknown, value: unknown): void => {
		const request = control(value), entry = current;
		if (!entry || entry.openId !== request.openId || (entry.retirementId !== undefined && entry.retirementId !== request.retirementId)) return;
		entry.retirementId = request.retirementId;
		if (!entry.work) {
			let resolve!: () => void, reject!: (error: unknown) => void;
			entry.work = new Promise<void>((accept, refuse) => { resolve = accept; reject = refuse; });
			// Register before invoking the captured genuine local owner. A stop
			// synchronously fences it even while the actual close remains held.
			try { void Promise.resolve(Reflect.apply(entry.handler, undefined, [request.kind]) as Promise<void>).then(resolve, reject); }
			catch (error) { reject(error); }
			void entry.work.then(() => { entry.settled = true; }, () => { entry.settled = true; });
		}
		if (request.kind === 'retire' && !entry.ack) {
			entry.ack = entry.work.then(() => ipc.invoke(CONTROL.completed, { schemaVersion: 1, openId: entry.openId,
				retirementId: request.retirementId, outcome: 'retired' }), (error: unknown) => ipc.invoke(CONTROL.completed, {
					schemaVersion: 1, openId: entry.openId, retirementId: request.retirementId, outcome: 'failed', error: failure(error),
				}));
			void entry.ack.then(() => { if (entry.detached && current === entry) { current = undefined; ipc.removeListener(CONTROL.requested, listener); } }, () => undefined);
		}
	};
	return Object.freeze<LightscaperPreloadSessionCurrentV1>({
		invoke(channel, payload): Promise<unknown> {
			try {
				if (!allowed.has(channel)) throw new TypeError('Unsupported Lightscaper Session channel.');
				if (channel === CHANNELS.open) {
					const input = record(payload, 'Lightscaper Session opening', ['name', 'openId']);
					if (!current || current.detached || field(input, 'openId', 'Lightscaper Session opening') !== current.openId) throw new Error('Native Session requires its installed local owner before opening.');
				}
				return ipc.invoke(channel, payload).then(response);
			} catch (error) { return Promise.reject(error); }
		},
		installRetirement(openId, handler): () => void {
			if (!/^[a-f0-9]{64}$/u.test(openId) || typeof handler !== 'function') throw new TypeError('Native Session requires a local opening ID and retirement owner.');
			if (current) throw new Error('Native Session local retirement is already installed.');
			const entry: Entry = { openId, handler, detached: false, settled: false }; current = entry; ipc.on(CONTROL.requested, listener);
			return () => {
				if (entry.detached) return; entry.detached = true;
				if ((!entry.work || entry.settled) && current === entry) { current = undefined; ipc.removeListener(CONTROL.requested, listener); }
			};
		},
	});
}
