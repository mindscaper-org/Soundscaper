/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';

/** This test-only desktop port authenticates generated fixture bytes without offering a production model. */
export async function installCorridorKeyFixture(page) {
	const keyedVideo = await readFile(new URL('../fixtures/corridorkey/keyed-alpha.webm', import.meta.url));
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ encoded }) => {
		const jobId = '01'.repeat(20), mediaType = 'application/vnd.soundscaper.frame-pack';
		const model = { modelId: 'corridorkey-2.0', version: '2.0.0', task: 'video-keying',
			artifactSha256s: ['ab', 'bc', 'cd', 'de', 'ef'].map((value) => value.repeat(32)) };
		const state = { events: [], fence: null, inputFrames: 0 };
		const bodies = new Map(); const inputs = [];
		let nextClaim = 1;
		const id = () => String(nextClaim++).padStart(40, '0');
		const digest = async (body) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await body.arrayBuffer()))]
			.map((value) => value.toString(16).padStart(2, '0')).join('');
		const claim = async (claimId, role, body) => ({ claimVersion: 1, claimId, jobId, role, mediaType: body.type,
			byteLength: body.size, sha256: await digest(body) });
		const unused = async () => { throw new Error('The installed CorridorKey fixture does not install models.'); };
		const localAssistance = {
			models: async () => [model], createJob: async () => { state.events.push('create'); return { contractVersion: 1, jobId }; },
			stageInput: async ({ bytes }) => { state.events.push('stage'); const key = id(); inputs.push(bytes); bodies.set(key, bytes); return claim(key, 'frame-pack', bytes); },
			reserveOutput: async (request) => ({ claimVersion: 1, claimId: id(), ...request }),
			run: async (request) => {
				state.events.push('run'); state.fence = request.selectionFence;
				const outputs = [];
				for (const [index, reservation] of request.outputs.entries()) {
					const bytes = new Uint8Array(await inputs[index].arrayBuffer()); const view = new DataView(bytes.buffer);
					const magic = new TextEncoder().encode('soundscaper-assistance-frame-pack-v2\n').length;
					const width = view.getUint32(magic + 12, true), height = view.getUint32(magic + 16, true);
					const count = view.getUint32(magic + 24, true); let offset = magic + 28;
					state.inputFrames += count;
					for (let frame = 0; frame < count; frame += 1) {
						offset += 16;
						for (let pixel = 0; pixel < width * height; pixel += 1) {
							const x = pixel % width; const position = offset + pixel * 4;
							bytes.set([255, 0, 0, x < 400 ? 255 : x < 800 ? 128 : 0], position);
						}
						offset += width * height * 4;
					}
					const body = new Blob([bytes], { type: mediaType }); bodies.set(reservation.claimId, body);
					outputs.push(await claim(reservation.claimId, 'keyed-frames', body));
				}
				return { contractVersion: 1, jobId, operation: 'video-keying', outcome: 'completed',
					result: { contractVersion: 1, jobId, operation: 'video-keying', outputs } };
			},
			readOutput: async ({ claim: value }) => { state.events.push(`read:${value.role}`); return bodies.get(value.claimId); },
			cancel: async () => ({ contractVersion: 1, jobId, outcome: 'cancelled' }),
			release: async () => { state.events.push('release'); bodies.clear(); return true; }, onProgress: () => () => undefined,
			videoKeying: {
				available: async () => { state.events.push('encoder-preflight'); return true; },
				encode: async (request) => {
					state.events.push('encode'); const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
					const body = new Blob([bytes], { type: 'video/webm' }); const key = id(); bodies.set(key, body);
					const output = await claim(key, 'keyed-video', body);
					return { contractVersion: 1, jobId, sourceId: request.sourceId, claim: output,
						inspection: { width: 1280, height: 720, frameCount: 4, frameRate: { num: 4, den: 1 }, sha256: output.sha256,
							timing: { timescale: 1000, presentationTicks: ['0', '250', '500', '750'], finalFrameDurationTicks: '250' },
							characteristics: { videoCodec: 'vp9', hasAlpha: true, bitDepth: 8, pixelFormat: 'yuva420p',
								colorPrimaries: null, colorTransfer: null, colorSpace: null, colorRange: 'limited' } } };
				},
			},
		};
		const bridge = {
			getEnvironment: async () => null, signalReady: async () => undefined, setLocale: async () => undefined,
			onMenuCommand: () => () => undefined, onOpenProject: () => () => undefined,
			onCloseRequested: () => () => undefined, onWindowStateChanged: () => () => undefined,
			listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [{ ...model,
				artifactSha256s: undefined, downloadBytes: 1024, installedBytes: 1024, availability: 'installed', attributionRequired: true }]
				.map(({ artifactSha256s: _unused, ...record }) => record) }),
			installAssistanceModel: unused, cancelAssistanceModelInstall: unused, installPreseededAssistanceModel: unused,
			reconcileAssistanceModels: unused, collectAssistanceModelGarbage: unused, listAssistanceModelNotices: async () => [],
			relocateAssistanceModels: unused, removeAssistanceModel: unused, onAssistanceInstallProgress: () => () => undefined,
			localAssistance,
		};
		Object.defineProperty(globalThis, 'framescaperDesktop', { configurable: true, enumerable: true,
			value: Object.freeze({ v1: Object.freeze(bridge) }) });
		globalThis.__corridorKeyFixture = state;
	}, { encoded: keyedVideo.toString('base64') });
}
