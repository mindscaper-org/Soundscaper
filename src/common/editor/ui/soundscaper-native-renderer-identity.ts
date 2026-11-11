/* SPDX-License-Identifier: AGPL-3.0-only */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type { NativePluginInstanceProjectionV1, NativePluginProjectStateV1 } from './soundscaper-native-services-bridge.ts';

const TEXT_ENCODER = new TextEncoder();
export function installationIdFor(binarySha256: string, stableId: string): string {
	return `i${bytesToHex(sha256(TEXT_ENCODER.encode(`${binarySha256}\0${stableId}`))).slice(0, 15)}`;
}

export function offlineInstanceId(instanceId: string, sequence: number): string {
	return `o${bytesToHex(sha256(TEXT_ENCODER.encode(`${instanceId}\0${String(sequence)}`))).slice(0, 31)}`;
}

export function assertOfflineIdentity(
	instance: NativePluginInstanceProjectionV1,
	state: NativePluginProjectStateV1,
	runtimeInstanceId: string,
): void {
	if (instance.instanceId !== runtimeInstanceId || instance.format !== state.format
		|| instance.stablePluginId !== state.stablePluginId || instance.binarySha256 !== state.binarySha256) {
		throw new Error('The offline native plug-in no longer matches the persisted project identity.');
	}
}
