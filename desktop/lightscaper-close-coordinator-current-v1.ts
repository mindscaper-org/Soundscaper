/* SPDX-License-Identifier: AGPL-3.0-only */

import { readLightscaperCloseRequestCurrentV1, readLightscaperCloseResponseCurrentV1,
	type LightscaperCloseRequestCurrentV1 } from './lightscaper-shell-contract-current-v1.ts';

interface LightscaperClosePortsCurrentV1 {
	readonly createRequestId: () => string;
	readonly sendRequest: (request: Readonly<LightscaperCloseRequestCurrentV1>) => void;
	readonly closeWindow: () => void;
	readonly quitApplication: () => void;
	readonly flushStorage: () => void;
}

/** Native window-close/quit admission belongs to the mounted browser session.
 * A navigation invalidates every old response before another renderer mounts. */
export function createLightscaperCloseCoordinatorCurrentV1(ports: LightscaperClosePortsCurrentV1) {
	let ready = false, quitting = false, allowed = false;
	let pending: Readonly<LightscaperCloseRequestCurrentV1> | undefined;
	return Object.freeze({
		signalReady(): boolean { if (ready) return false; ready = true; return true; },
		beforeQuit(): void { quitting = true; },
		invalidateRenderer(): void { ready = false; pending = undefined; allowed = false; quitting = false; },
		requestWindowClose(): boolean {
			if (allowed || !ready) return true;
			if (!pending) {
				pending = readLightscaperCloseRequestCurrentV1({ requestId: ports.createRequestId(), reason: quitting ? 'quit' : 'window-close' });
				ports.sendRequest(pending);
			}
			return false;
		},
		respond(value: unknown): boolean {
			const response = readLightscaperCloseResponseCurrentV1(value);
			if (!pending || response.requestId !== pending.requestId) return false;
			const request = pending;
			if (!response.allow) { pending = undefined; quitting = false; return true; }
			ports.flushStorage();
			pending = undefined; allowed = true;
			if (quitting || request.reason === 'quit') ports.quitApplication();
			else ports.closeWindow();
			return true;
		},
	});
}
