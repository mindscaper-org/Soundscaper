/* SPDX-License-Identifier: AGPL-3.0-only */

import { installDesktopSpeedWarmupManifest } from './desktop-speed-warmup-fixture.js';

export async function installNativeServicesFixture(page, { watchedVideo = null, parameters = null } = {}) {
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript(({ watchedVideo, parameters }) => {
		const calls = [];
		const preferences = {
			nativeMediaEnabled: false,
			hardwareDecodeEnabled: false,
			hardwareEncodeEnabled: false,
			ofxConsentEnabled: false,
		};
		let queueState = 'queued';
		let watchRules = [];
		let watchClaimed = false;
		const queueRow = () => ({
			jobId: '12'.repeat(20), taskKind: 'encoded-export',
			schemaFamily: 'framescaper', schemaVersion: 1, projectId: 'browser-v28',
			relativeDestination: 'exports/reel.mov', state: queueState,
			position: 0, progress: null, attempt: 0, lastFailureCode: null,
		});
		const capability = (domain, id, userEnabled = preferences.nativeMediaEnabled) => ({
			domain, id,
			state: preferences.nativeMediaEnabled ? 'available' : 'disabled',
			reason: preferences.nativeMediaEnabled ? 'ready' : 'master-switch-off',
			userEnabled, buildFingerprint: null, detail: null,
		});
		const nativeServices = {
			snapshot: async () => {
				calls.push(['snapshot']);
				return {
					snapshotVersion: 1, runtimeAvailable: true,
					nativeMediaEnabled: preferences.nativeMediaEnabled,
					queue: [queueRow()],
					roots: [{ grantId: 'ab'.repeat(16), displayName: 'Media', revoked: false }],
					watchRules,
				};
			},
			control: async ({ action }) => {
				calls.push(['control', action]);
				queueState = action === 'pause' ? 'paused' : queueState;
				return queueRow();
			},
			reorder: async () => [queueRow()],
			remove: async () => false,
			capabilities: async () => ({
				snapshotVersion: 1,
				masterEnabled: preferences.nativeMediaEnabled,
				buildFingerprint: null,
				entries: [
					capability('queue', 'persistent-render-queue'),
					capability('watch', 'watch-folders'),
					capability('codec', 'encode-mov-prores-proxy'),
					capability('operation', 'image-sequence-import'),
					capability('display', 'external-display'),
					capability('ofx', 'isolated-host', preferences.ofxConsentEnabled),
				],
			}),
			preferences: async () => ({ ...preferences }),
			setPreference: async ({ preference, enabled }) => {
				calls.push(['setPreference', preference, enabled]);
				const fields = {
					'native-media': 'nativeMediaEnabled',
					'hardware-decode': 'hardwareDecodeEnabled',
					'hardware-encode': 'hardwareEncodeEnabled',
					'ofx-consent': 'ofxConsentEnabled',
				};
				preferences[fields[preference]] = enabled;
				return enabled;
			},
			createWatch: async (request) => {
				calls.push(['createWatch', structuredClone(request)]);
				const rule = {
					ruleId: 'cd'.repeat(16), ...structuredClone(request), enabled: true,
				};
				watchRules = [rule];
				return rule;
			},
			setWatchEnabled: async ({ ruleId, enabled }) => {
				watchRules = watchRules.map((rule) => rule.ruleId === ruleId ? { ...rule, enabled } : rule);
				return watchRules.find((rule) => rule.ruleId === ruleId);
			},
			removeWatch: async ({ ruleId }) => {
				watchRules = watchRules.filter((rule) => rule.ruleId !== ruleId);
				return true;
			},
			reconcileWatch: async () => ({ reconciled: watchRules.length }),
			claimWatchImport: async (request) => {
				if (!watchedVideo) return null;
				calls.push(['claimWatchImport', structuredClone(request)]);
				if (watchClaimed || !watchRules.some((rule) => rule.projectId === request.projectId)) return null;
				watchClaimed = true;
				const claim = {
					schemaFamily: 'framescaper', schemaVersion: 1,
					claimId: 'de'.repeat(16), projectId: request.projectId,
					projectRevision: request.projectRevision, binId: 'project-bin',
					generateProxies: false, existingSourceId: null, importMode: 'link',
					locatorId: 'ab'.repeat(32), locatorRevision: 'cd'.repeat(32),
					...watchedVideo, lastModified: 123,
				};
				calls.push(['offeredWatchImport', structuredClone(claim)]);
				return claim;
			},
			completeWatchImport: async (request) => {
				calls.push(['completeWatchImport', structuredClone(request)]);
				return true;
			},
			listOpenFxPlugins: async () => {
				calls.push(['listOpenFxPlugins']);
				return [{
					pluginHandle: '12'.repeat(20), pluginId: 'net.example.BrowserFilter',
					vendor: 'Example', version: { major: 1, minor: 0 },
					binarySha256: 'ab'.repeat(32), supportedContexts: ['filter'],
					parameters: parameters ?? [
						{ name: 'enabled', type: 'boolean', animates: false },
						{ name: 'customState', type: 'custom', animates: false },
					],
					components: ['RGBA'], pixelDepths: ['byte'], threading: 'instance-safe',
					state: 'enabled', quarantined: false,
				}];
			},
			runOpenFxInteract: async (request) => {
				const copied = structuredClone(request);
				calls.push(['runOpenFxInteract', copied]);
				const terminal = copied.events.at(-1)?.kind === 'focus'
					&& copied.events.at(-1).focused === false;
				const retained = copied.target === 'custom-parameter' && copied.events.length === 0;
				const enabled = copied.effect.parameters.find(({ name }) => name === 'enabled');
				return {
					protocolVersion: 1, project: copied.project,
					instanceId: copied.effect.instanceId,
					effectStateSha256: copied.effectStateSha256,
					width: 64, height: 64, rowBytes: 256,
					target: copied.target, parameterName: copied.parameterName,
					acceptedSequences: copied.events.map(({ sequence }) => sequence),
					redrawRequested: !retained && copied.events.length > 0,
					surfaceDisposition: retained ? 'retained' : 'drawn',
					parameterMutations: terminal && enabled ? [{
						parameter: { ...enabled, value: !enabled.value },
					}] : [],
					rgba: new Uint8Array(64 * 64 * 4).fill(retained ? 0 : 0x33),
				};
			},
		};
		Object.defineProperty(globalThis, '__framescaperNativeCalls', {
			configurable: true, value: calls,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: Object.freeze({
				getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null, detail: '', canInstall: false, canBrowse: false, canClear: false }),
				nativeServices: Object.freeze(nativeServices),
				...(watchedVideo ? {
					chooseLinkedVideoOriginal: async () => null,
					loadLinkedVideoOriginal: async ({ locatorId, expectedRevision, playback }) => {
						if (playback) return null;
						return locatorId === 'ab'.repeat(32) && expectedRevision === 'cd'.repeat(32)
							? {
								locatorRevision: 'cd'.repeat(32),
								descriptor: {
									id: 'ef'.repeat(32), readProfile: 'materialized-v1',
									url: `${location.origin}/__e2e-watch-file`,
									name: watchedVideo.name, size: watchedVideo.size,
									mimeType: watchedVideo.mimeType, lastModified: 123,
								},
							}
							: null;
					},
					reconcileLinkedVideoOriginals: async () => 0,
					releaseLinkedVideoOriginal: async () => true,
				} : {}),
				readNativeTierControls: async () => ({
					probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
				applyNativeTierControl: async () => ({
					probeHelperEnabled: false, probeHelperQuarantined: false,
					audioHelperEnabled: false, audioHelperQuarantined: false,
					nativeEffectDiscoveryEnabled: false,
				}),
			}) }),
		});
	}, { watchedVideo, parameters });
}
