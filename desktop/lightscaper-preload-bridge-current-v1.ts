/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LIGHTSCAPER_SHELL_CHANNELS_CURRENT_V1 as CHANNELS,
	readLightscaperCloseRequestCurrentV1, readLightscaperCloseResponseCurrentV1,
	readLightscaperEnvironmentCurrentV1, readLightscaperMenuCommandCurrentV1,
	type LightscaperCloseRequestCurrentV1, type LightscaperShellEnvironmentCurrentV1,
} from './lightscaper-shell-contract-current-v1.ts';

type WireListener = (event: unknown, value: unknown) => void;
export interface LightscaperPreloadIpcCurrentV1 {
	invoke(channel: string, ...args: unknown[]): Promise<unknown>;
	on(channel: string, listener: WireListener): unknown;
	removeListener(channel: string, listener: WireListener): unknown;
}
export interface LightscaperPreloadBridgeCurrentV1 {
	getEnvironment(): Promise<Readonly<LightscaperShellEnvironmentCurrentV1>>;
	signalReady(): Promise<void>;
	respondToClose(response: unknown): Promise<void>;
	onCloseRequested(listener: (request: Readonly<LightscaperCloseRequestCurrentV1>) => void): () => void;
	onMenuCommand(listener: (request: Readonly<{ command: 'preferences' }>) => void): () => void;
}

/** A closed lifecycle bridge. Renderer code receives no IPC objects, native
 * file paths, native product-library services or local-model interfaces. */
export function createLightscaperPreloadBridgeCurrentV1(ipc: LightscaperPreloadIpcCurrentV1): Readonly<LightscaperPreloadBridgeCurrentV1> {
	function subscribe<Value>(channel: string, listener: (value: Value) => void, read: (value: unknown) => Value): () => void {
		if (typeof listener !== 'function') throw new TypeError('Lightscaper subscription requires a listener.');
		let attached = true;
		const wire: WireListener = (_event, value) => { if (attached) listener(read(value)); };
		ipc.on(channel, wire);
		return () => { if (attached) { attached = false; ipc.removeListener(channel, wire); } };
	}
	return Object.freeze({
		async getEnvironment(): Promise<Readonly<LightscaperShellEnvironmentCurrentV1>> {
			return readLightscaperEnvironmentCurrentV1(await ipc.invoke(CHANNELS.environment));
		},
		signalReady(): Promise<void> { return acknowledge(ipc.invoke(CHANNELS.ready)); },
		respondToClose(response: unknown): Promise<void> {
			const captured = readLightscaperCloseResponseCurrentV1(response);
			return acknowledge(ipc.invoke(CHANNELS.respond, captured));
		},
		onCloseRequested(listener: (request: Readonly<LightscaperCloseRequestCurrentV1>) => void): () => void {
			return subscribe(CHANNELS.closeRequested, listener, readLightscaperCloseRequestCurrentV1);
		},
		onMenuCommand(listener: (request: Readonly<{ command: 'preferences' }>) => void): () => void {
			return subscribe(CHANNELS.menuCommand, listener, readLightscaperMenuCommandCurrentV1);
		},
	});
}
async function acknowledge(work: Promise<unknown>): Promise<void> {
	if (typeof await work !== 'boolean') throw new TypeError('Invalid Lightscaper lifecycle acknowledgement.');
}
