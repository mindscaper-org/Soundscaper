/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The native helper's control plane. In the application this module is the
 * entry of an Electron utility process spawned and owned by main; in tests it
 * is constructed directly with an injected post seam and engine loader, so the
 * contract duties are exercised without platform authority and the real
 * process boundary is exercised separately by the real-process smoke.
 *
 * Professional plug-in roles reopen hash-verified staged authority and proxy
 * the third-party-loading peer through the enforced child launcher.
 */

import { createSingleKindHelperWorker } from './helper-single-kind-worker.js';
import { loadVerifiedNativeAddon } from './native-helper-addon.js';
import { createNativePersistentPluginJobRunner } from './native-helper-persistent-plugin-job.js';
import { createNativePersistentVampAnalyzerJobRunner } from './native-helper-persistent-vamp-analyzer-job.js';
import { authenticatePluginCandidate } from './plugin-candidate-authentication.mjs';

/** One process role owns one native authority family. */
export const NATIVE_HELPER_ROLES = Object.freeze({
	'plugin-scanner': Object.freeze({ kind: 'plugin-scan', serviceName: 'soundscaper-native-plugin-scanner' }),
	'plugin-host': Object.freeze({ kind: 'plugin-host', serviceName: 'soundscaper-native-plugin-host' }),
	'plugin-analyzer': Object.freeze({ kind: 'plugin-analyze', serviceName: 'soundscaper-native-plugin-analyzer' }),
});

/** Aggregate vocabulary for callers selecting a dedicated role. */
export const NATIVE_HELPER_JOB_KINDS = Object.freeze(
	Object.values(NATIVE_HELPER_ROLES).map(({ kind }) => kind),
);

export function createNativeHelperWorker({
	role,
	post,
	runJob = null,
	// Transitional injected names keep the focused runner tests source-stable;
	// only the runner matching `role` is ever retained or callable.
	runScanJob = null,
	runHostJob = null,
	runAnalyzerJob = null,
	heartbeatIntervalMs,
	setIntervalImpl = setInterval,
	clearIntervalImpl = clearInterval,
	exit = () => {},
}) {
	const descriptor = nativeHelperRole(role);
	const selectedRunner = runJob ?? ({
		'plugin-scanner': runScanJob,
		'plugin-host': runHostJob,
		'plugin-analyzer': runAnalyzerJob,
	})[role];
	if (typeof selectedRunner !== 'function') {
		throw new TypeError(`The ${role} native helper role needs its one job runner.`);
	}
	return createSingleKindHelperWorker({
		kind: descriptor.kind,
		post,
		runJob: selectedRunner,
		heartbeatIntervalMs,
		setIntervalImpl,
		clearIntervalImpl,
		exit,
	});
}

export function nativeHelperRole(value) {
	if (typeof value !== 'string' || !Object.hasOwn(NATIVE_HELPER_ROLES, value)) {
		throw new RangeError('A native helper process requires one closed role.');
	}
	return NATIVE_HELPER_ROLES[value];
}

const parentPort = globalThis.process?.parentPort;
if (parentPort && typeof parentPort.on === 'function') {
	const argument = process.argv.find((value) => value.startsWith('--helper-addon-config='));
	const config = JSON.parse(argument ? argument.slice('--helper-addon-config='.length) : '{}');
	const roleArgument = process.argv.find((value) => value.startsWith('--helper-role='));
	const role = roleArgument ? roleArgument.slice('--helper-role='.length) : '';
	nativeHelperRole(role);
	const { createHash } = await import('node:crypto');
	const addonSeams = config.payloadKind === 'professional'
		? await createProfessionalNativeHelperRoleSeams(config.location, role, {}, config.wine)
		: { addonPath: config.addonPath, addonSha256: config.addonSha256, loadAddon: loadVerifiedNativeAddon };
	const hashFile = authenticatePluginCandidate;
	let runJob;
	if (role === 'plugin-scanner') {
		const { createNativePluginScanJobRunner } = await import('./native-helper-scan-job.js');
		runJob = createNativePluginScanJobRunner({ ...addonSeams, hashFile });
	} else if (role === 'plugin-analyzer') {
		runJob = createNativePersistentVampAnalyzerJobRunner({ ...addonSeams, hashFile });
	} else {
		const { createNativePluginHostJobRunner } = await import('./native-helper-host-job.js');
		const runOneShot = createNativePluginHostJobRunner({ ...addonSeams, hashFile, hash: () => createHash('sha256') });
		const runPersistent = createNativePersistentPluginJobRunner({ ...addonSeams, hashFile });
		runJob = (request) => request.grant.persistentPort ? runPersistent(request) : runOneShot(request);
	}
	const worker = createNativeHelperWorker({
		role,
		post: (message) => parentPort.postMessage(message),
		runJob,
		exit: (code) => process.exit(code),
	});
	parentPort.on('message', (event) => worker.handleMessage(event.data, event.ports ?? []));
}

export async function createProfessionalNativeHelperRoleSeams(location, role, ports = {}, wine = null) {
	nativeHelperRole(role);
	const { createSoundscaperProfessionalNativeVerifier } = await import('./soundscaper-professional-native-payload.mjs');
	const descriptor = await (ports.verifyPayload ?? createSoundscaperProfessionalNativeVerifier({ ...location,
		instrumentResources: role === 'plugin-host' || role === 'plugin-scanner' }))();
	if (!descriptor.pluginPeer || !descriptor.isolation?.entrypoint) {
		throw new Error('Professional plug-in roles require an authenticated peer/isolation closure.');
	}
	const createLauncher = ports.createLauncher ?? (await import(
		'./project-library-runtime/desktop/native-child-isolation-launcher.js')).createNativeChildIsolationLauncher;
	let entryExecutable = descriptor.isolation.entrypoint;
	let entryArguments = Object.freeze([]);
	let runtimeClosure = descriptor.isolation.runtimeClosure;
	if (descriptor.target.startsWith('linux-')) {
		const resolveLinuxSystemRuntime = ports.resolveLinuxSystemRuntime ?? (await import(
			'./project-library-runtime/desktop/soundscaper-professional-linux-system-runtime.js'
		)).resolveSoundscaperProfessionalLinuxSystemRuntime;
		const systemRuntime = await resolveLinuxSystemRuntime({
			target: descriptor.target, peer: descriptor.pluginPeer,
			runtimeClosure: descriptor.isolation.runtimeClosure,
		});
		if (systemRuntime?.schemaVersion !== 1
			|| systemRuntime.policy !== 'host-system-elf-runtime-v1') {
			throw new Error('The professional Linux host-system runtime policy is invalid.');
		}
		entryExecutable = systemRuntime.entryExecutable;
		entryArguments = systemRuntime.loaderArguments;
		runtimeClosure = systemRuntime.runtimeClosure;
	}
	const launcher = createLauncher({
		target: descriptor.target,
		machineWorkload: Object.freeze({
			kind: 'soundscaper',
			payloads: Object.freeze([descriptor.pluginPeer]),
			runtimeClosure,
		}),
		artifacts: {
			launcher: descriptor.isolation.launcher,
			sandboxProfile: descriptor.isolation.sandboxProfile,
			brokerPolicy: descriptor.isolation.brokerPolicy,
		},
	});
	const machineAvailability = await launcher.machineReady();
	if (machineAvailability.status !== 'ready') {
		throw new Error(`The professional child launcher is unavailable: ${machineAvailability.detail}`);
	}
	let peer;
	if (role === 'plugin-analyzer') {
		const createVampPeer = ports.createVampPeer ?? (await import(
			'./project-library-runtime/desktop/soundscaper-professional-vamp-peer.js'
		)).createSoundscaperProfessionalVampPeer;
		peer = createVampPeer({
			launcher, peerExecutable: descriptor.pluginPeer, entryExecutable, entryArguments,
			runtimeReadExecute: runtimeClosure,
		});
	} else {
		const createPeer = ports.createPeer ?? (await import(
			'./project-library-runtime/desktop/soundscaper-professional-plugin-peer.js'
		)).createSoundscaperProfessionalPluginPeer;
		const { bundledPluginFactoryDirectory, withBundledPluginFactoryData } = await import('#desktop-runtime/bundled-plugin-factory-data');
		const factoryData = await bundledPluginFactoryDirectory(descriptor);
		const formats = descriptor.target.startsWith('mac-') ? ['vst3', 'vst2', 'clap', 'au']
			: descriptor.target.startsWith('linux-') ? ['vst3', 'vst2', 'clap', 'lv2', 'ladspa'] : ['vst3', 'vst2', 'clap'];
		let effectPeer = createPeer({
			launcher: withBundledPluginFactoryData(descriptor.target.startsWith('win-')
				? (ports.createPluginLauncher ?? (await import('./project-library-runtime/desktop/native-plugin-process-launcher.js'))
					.createNativePluginProcessLauncher)({ target: descriptor.target, peerExecutable: descriptor.pluginPeer, factoryData,
					artifacts: { launcher: descriptor.isolation.launcher, sandboxProfile: descriptor.isolation.sandboxProfile,
						brokerPolicy: descriptor.isolation.brokerPolicy } }) : launcher, factoryData),
			peerExecutable: descriptor.pluginPeer, entryExecutable, entryArguments,
			runtimeReadExecute: descriptor.target.startsWith('win-') ? [] : runtimeClosure, pluginFormats: formats,
		});
		if (descriptor.target === 'win-x64' && runtimeClosure.some(({ path }) => path.replaceAll('\\', '/').endsWith('/runtime/soundscaper_vst2_x86_peer.exe'))) {
			const { attachWindowsVst2Bridge } = await import('./project-library-runtime/desktop/windows-vst2-bridge-runtime.js');
			effectPeer = attachWindowsVst2Bridge({ target: descriptor.target, nativePeer: effectPeer,
				nativeExecutable: descriptor.pluginPeer, runtimeClosure,
				artifacts: { launcher: descriptor.isolation.launcher, sandboxProfile: descriptor.isolation.sandboxProfile,
					brokerPolicy: descriptor.isolation.brokerPolicy } });
		}
		if (descriptor.target === 'linux-x64' && wine) {
			const { attachWineVst3Bridge } = await import('./project-library-runtime/desktop/wine-vst3-runtime.js');
			effectPeer = await attachWineVst3Bridge({ nativePeer: effectPeer, peerExecutable: descriptor.pluginPeer,
				entryExecutable, entryArguments, runtimeClosure, configuration: wine });
		}
		if (role === 'plugin-scanner') {
			const createVampPeer = ports.createVampPeer ?? (await import(
				'./project-library-runtime/desktop/soundscaper-professional-vamp-peer.js'
			)).createSoundscaperProfessionalVampPeer;
			const vampPeer = createVampPeer({
				launcher, peerExecutable: descriptor.pluginPeer, entryExecutable, entryArguments,
				runtimeReadExecute: runtimeClosure,
			});
			peer = composeProfessionalScannerPeer(effectPeer, vampPeer);
		} else peer = effectPeer;
	}
	return { addonPath: descriptor.pluginPeer.path, addonSha256: descriptor.pluginPeer.sha256,
		loadAddon: async () => peer };
}

function composeProfessionalScannerPeer(effectPeer, vampPeer) {
	return Object.freeze({
		describe: async () => {
			const description = await effectPeer.describe();
			return Object.freeze({ ...description,
				pluginFormats: Object.freeze([...description.pluginFormats, 'vamp']) });
		},
		listPluginCandidates: (root, suffix, format) => format === 'vamp'
			? vampPeer.listPluginCandidates(root, suffix)
			: effectPeer.listPluginCandidates(root, suffix),
		inspectPluginCandidate: (path, format, context) => format === 'vamp'
			? vampPeer.inspectPluginCandidate(path, format, context)
			: effectPeer.inspectPluginCandidate(path, format, context),
		scanExactLibrary: (...arguments_) => vampPeer.scanExactLibrary(...arguments_),
	});
}
