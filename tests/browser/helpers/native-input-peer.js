/* SPDX-License-Identifier: AGPL-3.0-only */

import { installNativeOutputPeer } from './native-output-peer.js';

/** A real native input worklet exchanges owned microphone packets with a helper thread. */
export async function installNativeInputPeer(page) {
	await installNativeOutputPeer(page);
	await page.addInitScript(() => {
		const api = window.soundscaperDesktop.v1, requests = new Map(), peers = new Map();
		window.__nativeInputPeer = { requests: [], contexts: [] };
		const Context = AudioContext;
		window.AudioContext = new Proxy(Context, { construct(target, args, newTarget) {
			const context = Reflect.construct(target, args, newTarget);
			window.__nativeInputPeer.contexts.push(context); return context;
		} });
		const describe = api.describeNativeAudioBackend, open = api.openNativeAudioSession;
		const bind = api.bindNativeAudioSession, close = api.closeNativeAudioSession;
		api.describeNativeAudioBackend = async request => {
			const result = await describe(request);
			result.inventory.devices.push({ handle: 'microphone', label: 'Chosen native microphone', direction: 'input', channelCount: 2, isDefault: true });
			return result;
		};
		api.openNativeAudioSession = async request => {
			const result = await open(request);
			if (result.sessionId) { requests.set(result.sessionId, request); window.__nativeInputPeer.requests.push({ sessionId: result.sessionId, ...request }); }
			return request.direction === 'input' ? { ...result, deviceHandle: 'microphone' } : result;
		};
		api.bindNativeAudioSession = async ({ sessionId }) => {
			const request = requests.get(sessionId);
			if (request.direction === 'output') return bind({ sessionId });
			const pair = new MessageChannel(), url = URL.createObjectURL(new Blob([`
				onmessage = ({ data }) => {
					const { port, rate } = data;
					port.onmessage = ({ data }) => {
						if (data.kind !== 'capture-credit') return;
						for (const channel of data.channels) for (let frame = 0; frame < channel.length; frame++) {
							channel[frame] = (rate === 44100 ? .02 : .2) * Math.sin(2 * Math.PI * 440 * (data.startFrame + frame) / rate);
						}
						port.postMessage({ ...data, kind: 'audio', status: 'ok', framesTransferred: data.frameCount }, data.channels.map(channel => channel.buffer));
					};
					port.start(); postMessage({ ready: true });
				};
			`], { type: 'text/javascript' }));
			const worker = new Worker(url); peers.set(sessionId, { worker, url });
			await new Promise((resolve, reject) => {
				worker.onmessage = () => resolve(); worker.onerror = reject;
				worker.postMessage({ port: pair.port1, rate: request.sampleRate }, [pair.port1]);
			});
			window.postMessage({ type: 'soundscaper-native-realtime-port-v1', offer: {
				sessionId, protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: request.sampleRate,
				channelCount: request.channelCount, frameCount: request.periodFrames, queueCapacity: 8, startFrame: 0,
			} }, location.origin, [pair.port2]);
			return { status: 'bound' };
		};
		api.closeNativeAudioSession = async ({ sessionId }) => {
			const peer = peers.get(sessionId); peer?.worker.terminate();
			if (peer) URL.revokeObjectURL(peer.url); peers.delete(sessionId);
			return close({ sessionId });
		};
	});
}
