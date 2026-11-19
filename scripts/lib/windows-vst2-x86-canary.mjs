/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nativeChildFileIdentityFromStat } from '../../desktop/native-child-file-identity.ts';
import { createNativePluginProcessLauncher } from '../../desktop/native-plugin-process-launcher.ts';
import { createSoundscaperProfessionalPluginPeer } from '../../desktop/soundscaper-professional-plugin-peer.ts';
import { attachWindowsVst2Bridge } from '../../desktop/windows-vst2-bridge-runtime.ts';

/** Executed by x64 Node on the Windows producer against the installed x86 fixture. */
export async function runWindowsVst2X86Canary({ professionalInstallRoot, isolationInstallRoot, target }) {
	assert.equal(target, 'win-x64');
	assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
	const [nativeExecutable, bridgeExecutable, fixture, launcher, sandboxProfile, brokerPolicy] = await Promise.all([
		descriptor(resolve(professionalInstallRoot, 'soundscaper_professional_peer.exe')),
		descriptor(resolve(professionalInstallRoot, 'runtime/soundscaper_vst2_x86_peer.exe')),
		descriptor(resolve(professionalInstallRoot, 'self-test-x86/SoundscaperVST2Fixture.dll')),
		descriptor(resolve(isolationInstallRoot, 'bin/milestone5-native-isolation-launcher.exe')),
		descriptor(resolve(isolationInstallRoot, 'profiles/windows-v1.json')),
		descriptor(resolve(isolationInstallRoot, 'profiles/windows-broker-v1.json')),
	]);
	const artifacts = { launcher, sandboxProfile, brokerPolicy };
	const nativePeer = createSoundscaperProfessionalPluginPeer({
		launcher: createNativePluginProcessLauncher({ target, peerExecutable: nativeExecutable, artifacts }),
		peerExecutable: nativeExecutable, runtimeReadExecute: [], pluginFormats: ['vst2'],
	});
	const peer = attachWindowsVst2Bridge({ target, nativePeer, nativeExecutable,
		runtimeClosure: [bridgeExecutable], artifacts });
	const context = { ...fixture, resourcePolicy: { maximumInputBytes: fixture.byteLength,
		maximumJobDurationMs: 30_000, maximumRssBytes: 1024 ** 3,
		allowNetwork: false, allowChildProcesses: false, allowOutputFiles: false } };
	assert.equal((await peer.inspectPluginCandidate(fixture.path, 'vst2', context)).status, 'not-a-module');
	const consent = { ...context, windowsX86Vst2: true };
	const descriptions = await peer.inspectPluginCandidate(fixture.path, 'vst2', consent);
	assert.ok(Array.isArray(descriptions)); assert.equal(descriptions.length, 1);
	const description = descriptions[0];
	assert.equal(description.binaryArchitecture, 'ia32');
	assert.equal(description.inputChannels, 2); assert.equal(description.outputChannels, 2);
	let instance = await peer.openPluginInstance(fixture.path, 48_000, 128, 'vst2', description.stableId, consent);
	try {
		assert.equal(await peer.pluginLatencyFrames(instance), 8);
		const parameters = await peer.describePluginParameters(instance);
		const gain = parameters.find((parameter) => parameter.name === 'Gain');
		assert.ok(gain); await peer.writePluginParameter(instance, gain.index, 0.25);
		const state = await peer.savePluginState(instance); assert.ok(state.length > 0);
		const input = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)];
		const output = [new Float32Array(128), new Float32Array(128)];
		assert.equal(await peer.processPluginBlock(instance, 128, input, output), 128);
		assert.equal(output[0][0], 0); assert.equal(output[0][8], 0.25); assert.equal(output[1][127], 0.25);
		await peer.openPluginVendorWindow(instance, 'x86-vst2-canary');
		await peer.closePluginVendorWindow(instance, 'x86-vst2-canary');
		await peer.closePluginInstance(instance); instance = null;
		instance = await peer.openPluginInstance(fixture.path, 48_000, 128, 'vst2', description.stableId, consent);
		await peer.loadPluginState(instance, state);
		assert.equal(await peer.readPluginParameter(instance, gain.index), 0.25);
		return Object.freeze({ hostArchitecture: 'x64', pluginArchitecture: 'ia32', format: 'vst2',
			processing: 'passed', stateRoundTrip: 'passed', vendorWindow: 'passed', consentRefusal: 'passed' });
	} finally { if (instance) await peer.closePluginInstance(instance); }
}

async function descriptor(path) {
	const [bytes, metadata, canonical] = await Promise.all([readFile(path), lstat(path, { bigint: true }), realpath(path)]);
	assert.ok(metadata.isFile() && !metadata.isSymbolicLink() && canonical === path);
	return Object.freeze({ path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
		identity: nativeChildFileIdentityFromStat(metadata) });
}
