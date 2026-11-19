/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { readDesktopPreloadSource } from './desktop-preload-source.mjs';

export async function loadPreload(results) {
	let bridge;
	const invocations = [];
	const dataPlaneChunks = [];
	const displayFrames = [];
	const bulkPeers = new WeakSet();
	class PreloadMessageChannel extends MessageChannel {
		constructor() {
			super();
			const post = this.port2.postMessage.bind(this.port2);
			this.port2.postMessage = (message, transfer) => {
				if (bulkPeers.has(this.port1)) {
					assert.equal(transfer?.length ?? 0, 0, 'Electron bulk chunks must use structured clone');
				}
				post(message, transfer);
			};
		}
	}
	const source = await readDesktopPreloadSource();
	vm.runInNewContext(source, {
		AggregateError, Array, ArrayBuffer, JSON, Number, Object, Promise, RangeError, String,
		TypeError, Uint8Array, URL, Blob, MessageChannel: PreloadMessageChannel, setTimeout, clearTimeout,
		crypto: webcrypto, structuredClone,
		require: () => ({
			contextBridge: { exposeInMainWorld(name, value) { if (name === 'framescaperDesktop') bridge = value.v1; } },
			ipcRenderer: {
				invoke(channel, value) { invocations.push([channel, value]); return Promise.resolve(results.shift()); },
				postMessage(channel, value, ports) {
					invocations.push([channel, value]);
					const port = ports[0];
					if (channel.endsWith(':display:frame-port')) {
						assert.equal(ports.length, 2);
						assert.deepEqual(Object.keys(value), ['frame']);
						ports[1].once('message', (pixels) => {
							displayFrames.push({ byteLength: pixels.byteLength, sha256: createHash('sha256').update(pixels).digest('hex') });
							port.postMessage({ dataPlaneVersion: 1, type: 'result', streamId: value.frame.rgbaSha256.slice(0, 40),
								projection: results.shift() });
							ports[1].close();
							port.close();
						});
						return;
					}
					if (channel.endsWith(':image-sequence:import-port')
						|| channel.endsWith(':render-inputs:port')) bulkPeers.add(port);
					port.on('message', (message) => {
						if (message.type === 'chunk') {
							dataPlaneChunks.push({ sequence: message.sequence, offset: message.offset,
								byteLength: message.bytes.byteLength });
							port.postMessage({ dataPlaneVersion: 1, type: 'ack', streamId: message.streamId,
								sequence: message.sequence, receivedBytes: message.offset + message.bytes.byteLength });
						} else if (message.type === 'complete' && !channel.endsWith(':image-sequence:import-port')) {
							port.postMessage({ dataPlaneVersion: 1, type: 'result', streamId: message.streamId, projection: results.shift() });
						}
					});
					port.start();
				},
				send: () => undefined,
				on: () => undefined,
				removeListener: () => undefined,
			},
		}),
	});
	return { bridge, invocations, dataPlaneChunks, displayFrames };
}
