/* SPDX-License-Identifier: AGPL-3.0-only */
import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';

/** The production native worklet exchanges owned PCM packets with an independent helper thread. */
export async function installNativeOutputPeer(page, { outputChannelCount = 2, measureFrequency = false } = {}) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ outputChannelCount, measureFrequency }) => {
		const sessions = new Map(), peers = new Map();
		const pendingFences = new Map();
		let next = 0, nextFence = 0;
		const unavailable = { status: 'unavailable', reason: 'not-built', detail: '' };
		const queueCapacity = 8;
		window.__nativeOutput = { packets: 0, mean: 0, channelMeans: [], channelRms: [], loss: [], packetHistory: [], queueCapacity };
		window.__nativeOutput.fence = () => {
			const current = [...peers.entries()].at(-1);
			if (!current) throw new Error('No native output peer is attached.');
			const [sessionId, peer] = current, fence = ++nextFence;
			return new Promise((resolve, reject) => {
				pendingFences.set(fence, { sessionId, resolve, reject });
				peer.worker.postMessage({ fence });
			});
		};
		// This output-only fixture never grants an unrelated browser microphone.
		Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
			configurable: true, value: async () => new MediaStream(),
		});
		const bridge = {
			getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null,
				detail: '', canInstall: false, canBrowse: false, canClear: false }),
			getEnvironment: async () => null, signalReady: async () => {},
			onMenuCommand: () => () => {}, onOpenProject: () => () => {},
			onCloseRequested: () => () => {}, onWindowStateChanged: () => () => {},
			readNativeTierControls: async () => ({ probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: true, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false }),
			nativeAudioHelperAvailability: async () => ({ enabled: true, quarantined: false,
				payload: { status: 'available', reason: null, detail: '' }, backends: ['alsa'] }),
			setNativeAudioHelperEnabled: async () => true,
			nativePluginAvailability: async () => ({ enabled: false, quarantined: false, payload: unavailable,
				formats: [], consent: { scanningEnabled: false, formats: [] },
				quarantine: { loaded: true, degraded: false, records: [], pendingFaults: 0 } }),
			listNativePlugins: async () => ({ entries: [] }),
			nativePluginScanProgress: async () => ({ enabled: false, scanProgress: null }),
			describeNativeAudioBackend: async ({ backend }) => ({ status: 'described', inventory: {
				backend, status: 'ready', detail: '', devices: [{ handle: 'speakers', label: 'Chosen native speakers',
					direction: 'output', channelCount: outputChannelCount, isDefault: true }],
			} }),
			openNativeAudioSession: async request => {
				const sessionId = `route-${++next}`;
				sessions.set(sessionId, request);
				return { status: 'opened', sessionId, backend: 'alsa', deviceHandle: 'speakers' };
			},
			bindNativeAudioSession: async ({ sessionId }) => {
				const request = sessions.get(sessionId), pair = new MessageChannel();
				const url = URL.createObjectURL(new Blob([`
					let latestPacket = null, previousSample = null;
					const frequencies = [];
					onmessage = ({ data }) => {
						if (data.fence) { postMessage({ fence: data.fence, packet: latestPacket }); return; }
						const { port, rate, measureFrequency } = data;
						let packets = 0;
						const powers = [];
						port.onmessage = ({ data }) => {
							if (data.kind !== 'audio') return;
							let frequency;
							if (measureFrequency) {
								let crossings = 0;
								for (const sample of data.channels[0]) {
									if (previousSample !== null && (sample >= 0) !== (previousSample >= 0)) crossings++;
									previousSample = sample;
								}
								frequencies.push({ crossings, frames: data.frameCount });
								if (frequencies.length > 16) frequencies.shift();
								frequency = frequencies.reduce((sum, packet) => sum + packet.crossings, 0) * rate
									/ (2 * frequencies.reduce((sum, packet) => sum + packet.frames, 0));
							}
							const means = data.channels.map(channel => channel.reduce((sum, value) => sum + value, 0) / channel.length);
							powers.push(data.channels.map(channel => channel.reduce((sum, value) => sum + value * value, 0) / channel.length));
							if (powers.length > 64) powers.shift();
							const rms = means.map((_, index) => Math.sqrt(powers.reduce((sum, packet) => sum + packet[index], 0) / powers.length));
							latestPacket = { startFrame: data.startFrame, endFrame: data.startFrame + data.frameCount,
								frameCount: data.frameCount, peaks: data.channels.map(channel => channel.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0)) };
							postMessage({ frequency, packets: ++packets, mean: means[0], channelMeans: means, channelRms: rms, packet: latestPacket });
							port.postMessage({ ...data, kind: 'return', status: 'ok', framesTransferred: data.frameCount },
								data.channels.map(channel => channel.buffer));
						};
						port.start();
						postMessage({ ready: true });
					};
				`], { type: 'text/javascript' }));
				const worker = new Worker(url);
				peers.set(sessionId, { worker, url });
				await new Promise((resolve, reject) => {
					worker.onmessage = ({ data }) => {
						if (data.fence) {
							const pending = pendingFences.get(data.fence);
							pendingFences.delete(data.fence);
							pending?.resolve({ sessionId, packet: data.packet, periodFrames: request.periodFrames, queueCapacity });
						} else if (data.ready) resolve();
						else {
							Object.assign(window.__nativeOutput, data, { sessionId });
							window.__nativeOutput.packetHistory.push({ ...data.packet, sessionId });
							if (window.__nativeOutput.packetHistory.length > 64) window.__nativeOutput.packetHistory.shift();
						}
					};
					worker.onerror = reject;
					worker.postMessage({ port: pair.port1, rate: request.sampleRate, measureFrequency }, [pair.port1]);
				});
				window.postMessage({ type: 'soundscaper-native-realtime-port-v1', offer: {
					sessionId, protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: request.sampleRate,
					channelCount: request.channelCount, frameCount: request.periodFrames, queueCapacity, startFrame: 0,
				} }, window.location.origin, [pair.port2]);
				return { status: 'bound' };
			},
			reportNativeAudioSessionTransfer: async () => {},
			reportNativeAudioSessionLoss: async value => { window.__nativeOutput.loss.push(value); },
			closeNativeAudioSession: async ({ sessionId }) => {
				for (const [fence, pending] of pendingFences) if (pending.sessionId === sessionId) {
					pending.reject(new Error('The native peer closed before its packet fence.')); pendingFences.delete(fence);
				}
				const peer = peers.get(sessionId);
				peer?.worker.terminate();
				if (peer) URL.revokeObjectURL(peer.url);
				peers.delete(sessionId);
				return true;
			},
		};
		for (const name of ['setNativePluginConsent', 'scanNativePlugins', 'nativeAudioSessionStatus',
			'calibrateNativeAudioSession', 'setNativePluginInstallationAllowed', 'selectNativePluginInstallation',
			'instantiateNativePlugin', 'runNativePluginOffline', 'setNativePluginBypassed', 'persistNativePluginState',
			'restoreNativePluginState', 'openNativePluginVendorUi', 'closeNativePluginVendorUi', 'closeNativePluginInstance']) {
			bridge[name] = async () => { throw new Error(`Unexpected native fixture method ${name}`); };
		}
		Object.defineProperty(window, 'soundscaperDesktop', { configurable: true, value: { v1: bridge } });
	}, { outputChannelCount, measureFrequency });
}
