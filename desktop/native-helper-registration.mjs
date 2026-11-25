/* SPDX-License-Identifier: AGPL-3.0-only */

import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';

import { app, utilityProcess } from 'electron/main';

import { HelperSupervisor } from './project-library-runtime/desktop/helper-supervisor.js';
import {
	createNativeAddonVerifier,
	describeNativeAddonAvailability,
} from './project-library-runtime/desktop/native-addon-payload.js';
import {
	createSoundscaperProfessionalNativeVerifier,
	describeSoundscaperProfessionalNativePayload,
} from './soundscaper-professional-native-payload.mjs';

/**
 * Creates one supervisor for one native-helper role. Sharing a payload does
 * not share process authority: audio, scanning, and each future plug-in host
 * get separate utility processes and separate crash/quarantine generations.
 */
export function createDesktopNativeAddonHelperSupervisor({
	desktopRoot, packaged, resourcesPath, role, serviceName, payloadKind = 'fixture', runtimeContext = null,
}) {
	if (!['audio', 'plugin-scanner', 'plugin-host', 'plugin-analyzer'].includes(role)) {
		throw new RangeError('A native addon helper requires one closed process role.');
	}
	const applicationRoot = dirname(desktopRoot);
	const location = Object.freeze({ applicationRoot, packaged, resourcesPath, pluginOnly: role !== 'audio' });
	if (!['fixture', 'professional'].includes(payloadKind)) {
		throw new RangeError('A native helper requires one closed payload kind.');
	}
	const professional = payloadKind === 'professional';
	const verifyPayload = professional
		? createSoundscaperProfessionalNativeVerifier(location)
		: createNativeAddonVerifier(location);
	let child = null;
	let descriptor = null;
	const supervisor = new HelperSupervisor({
		verifyBinary: async () => {
			descriptor = await verifyPayload();
			if (professional && role !== 'audio'
				&& (!descriptor.pluginPeer || !descriptor.isolation?.entrypoint)) {
				throw new Error('A professional plug-in helper requires an authenticated peer/isolation closure.');
			}
		},
		spawn: async () => {
			if (!descriptor) throw new Error('The native helper payload was not verified before spawn.');
			const forked = utilityProcess.fork(
				join(desktopRoot, role === 'audio' ? 'native-audio-helper-process.js' : 'native-helper-process.js'),
				[
					`--helper-role=${role}`,
					`--helper-addon-config=${JSON.stringify(professional ? {
						payloadKind: 'professional', location, wine: await runtimeContext?.(),
					} : {
						payloadKind: 'fixture', addonPath: descriptor.path, addonSha256: descriptor.sha256,
					})}`,
				],
				{ serviceName },
			);
			child = forked;
			return Object.freeze({
				postMessage: (message, transfer = []) => forked.postMessage(message, transfer),
				onMessage: (listener) => forked.on('message', listener),
				onExit: (listener) => forked.on('exit', (code) => listener(code ?? null)),
				kill: () => forked.kill(),
			});
		},
		mintJobId: () => randomBytes(20).toString('hex'),
		sampleRss: () => {
			const pid = child?.pid;
			if (!pid) return null;
			const metric = app.getAppMetrics().find((entry) => entry.pid === pid);
			return metric ? metric.memory.workingSetSize * 1024 : null;
		},
	});
	return Object.freeze({
		location,
		supervisor,
		describePayload: () => professional
			? describeSoundscaperProfessionalNativePayload(location)
			: describeNativeAddonAvailability(location),
	});
}
