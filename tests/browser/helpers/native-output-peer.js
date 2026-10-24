/* SPDX-License-Identifier: AGPL-3.0-only */
import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';

/** The production native worklet exchanges owned PCM packets with an independent helper thread. */
export async function installNativeOutputPeer(page, { outputChannelCount = 2 } = {}) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ outputChannelCount }) => {
		const sessions = new Map(), peers = new Map();
		let next = 0;
		const unavailable = { status: 'unavailable', reason: 'not-built', detail: '' };
		window.__nativeOutput = { packets: 0, mean: 0, channelMeans: [], loss: [] };
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
					onmessage = ({ data: { port } }) => {
						let packets = 0;
						port.onmessage = ({ data }) => {
							if (data.kind !== 'audio') return;
							const means = data.channels.map(channel => channel.reduce((sum, value) => sum + value, 0) / channel.length);
							postMessage({ packets: ++packets, mean: means[0], channelMeans: means });
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
						if (data.ready) resolve();
						else Object.assign(window.__nativeOutput, data);
					};
					worker.onerror = reject;
					worker.postMessage({ port: pair.port1 }, [pair.port1]);
				});
				window.postMessage({ type: 'soundscaper-native-realtime-port-v1', offer: {
					sessionId, protocolVersion: 1, generation: 1, sampleFormat: 'f32-planar', sampleRate: request.sampleRate,
					channelCount: request.channelCount, frameCount: request.periodFrames, queueCapacity: 8, startFrame: 0,
				} }, '*', [pair.port2]);
				return { status: 'bound' };
			},
			reportNativeAudioSessionTransfer: async () => {},
			reportNativeAudioSessionLoss: async value => { window.__nativeOutput.loss.push(value); },
			closeNativeAudioSession: async ({ sessionId }) => {
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
	}, { outputChannelCount });
}
