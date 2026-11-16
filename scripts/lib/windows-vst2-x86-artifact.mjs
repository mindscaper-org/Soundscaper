/* SPDX-License-Identifier: AGPL-3.0-only */

import { windowsPluginArchitecture } from '../../desktop/windows-plugin-architecture.ts';
import { validateSoundscaperNativeBinaryArchitectureReceipt } from './soundscaper-native-binary-architecture.mjs';

export const WINDOWS_VST2_X86_ARTIFACT = 'payload/runtime/soundscaper_vst2_x86_peer.exe';

export function isWindowsVst2X86Artifact(target, path) {
	const normalized = String(path).replaceAll('\\', '/');
	return target === 'win-x64' && (normalized === WINDOWS_VST2_X86_ARTIFACT
		|| normalized.endsWith(`/${WINDOWS_VST2_X86_ARTIFACT}`));
}

export function windowsVst2X86Architecture(bytes) {
	if (windowsPluginArchitecture(bytes) !== 'ia32') throw new Error('The Windows x86 VST2 bridge is not PE32 i386.');
	return Object.freeze({ schemaVersion: 1, target: 'win-x64', format: 'pe32', architecture: 'ia32', machine: 'IMAGE_FILE_MACHINE_I386' });
}

/** PE32 is admitted for exactly one role; primary payloads remain target-native. */
export function validateProfessionalArtifactArchitecture(value, target, path) {
	if (!isWindowsVst2X86Artifact(target, path)) return validateSoundscaperNativeBinaryArchitectureReceipt(value, target);
	const expected = { schemaVersion: 1, target: 'win-x64', format: 'pe32', architecture: 'ia32', machine: 'IMAGE_FILE_MACHINE_I386' };
	if (!value || Object.keys(value).sort().join(',') !== Object.keys(expected).sort().join(',')
		|| Object.entries(expected).some(([key, entry]) => value[key] !== entry)) {
		throw new TypeError('The Windows x86 VST2 bridge architecture receipt is invalid.');
	}
	return value;
}
