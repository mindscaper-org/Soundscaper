/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import { createSingleKindHelperWorker } from './helper-single-kind-worker.js';
import { createNativeDeviceJobRunner } from './native-audio-device-job.js';
import { loadVerifiedNativeAddon } from './native-helper-addon.js';
import { createNativePersistentAudioJobRunner } from './native-helper-persistent-audio-job.js';

const parentPort = process.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const roleArgument = process.argv.find((value) => value.startsWith('--helper-role='));
	if (roleArgument !== '--helper-role=audio') throw new RangeError('The audio helper requires its audio role.');
	const argument = process.argv.find((value) => value.startsWith('--helper-addon-config='));
	const config = JSON.parse(argument ? argument.slice('--helper-addon-config='.length) : '{}');
	let addonPath = config.addonPath;
	let addonSha256 = config.addonSha256;
	if (config.payloadKind === 'professional') {
		const { createSoundscaperProfessionalNativeVerifier } = await import('./soundscaper-professional-native-payload.mjs');
		const descriptor = await createSoundscaperProfessionalNativeVerifier({ ...config.location, instrumentResources: false })();
		addonPath = descriptor.path;
		addonSha256 = descriptor.sha256;
	}
	const addonSeams = { addonPath, addonSha256, loadAddon: loadVerifiedNativeAddon };
	const runOneShot = createNativeDeviceJobRunner({ ...addonSeams, hash: () => createHash('sha256') });
	const runPersistent = createNativePersistentAudioJobRunner(addonSeams);
	const worker = createSingleKindHelperWorker({
		kind: 'audio-device',
		post: (message) => parentPort.postMessage(message),
		runJob: (request) => request.grant.persistentPort ? runPersistent(request) : runOneShot(request),
		exit: (code) => process.exit(code),
	});
	parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
}
