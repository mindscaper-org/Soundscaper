/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, realpath } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { BUNDLED_SURGE_DATA_PATH } from './bundled-native-plugins.ts';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import type { NativeChildIsolationPathGrant, NativeChildIsolationLaunchRequest } from './native-child-isolation-contract.ts';

export const BUNDLED_SURGE_DATA_ARGUMENT = '--bundled-surge-data-hex=';
export function bundledSurgeDataArgument(grant: NativeChildIsolationPathGrant): string {
	if (grant.kind !== 'directory') throw new TypeError('Bundled factory data requires a directory grant.');
	return BUNDLED_SURGE_DATA_ARGUMENT + Buffer.from(grant.path, 'utf8').toString('hex');
}

/** Called only after the professional payload has authenticated every declared resource. */
export async function bundledPluginFactoryDirectory(payload: {
	readonly pluginPeer: { readonly path: string };
	readonly isolation: { readonly pluginResources?: readonly { readonly path: string }[] };
}): Promise<NativeChildIsolationPathGrant | undefined> {
	const path = resolve(dirname(payload.pluginPeer.path), 'runtime', BUNDLED_SURGE_DATA_PATH);
	if (!payload.isolation.pluginResources?.some(resource => resource.path.startsWith(path + sep))) return undefined;
	if (await realpath(path) !== path) throw new Error('The bundled factory data root must be canonical.');
	const metadata = await lstat(path, { bigint: true });
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('The bundled factory data root is not a directory.');
	return Object.freeze({ path, kind: 'directory', identity: nativeChildFileIdentityFromStat(metadata) });
}

/** A single app-owned read-only data grant preserves the existing path-grant ceiling. */
export function withBundledPluginFactoryData<Launcher extends { launch(request: NativeChildIsolationLaunchRequest): unknown }>(
	launcher: Launcher, factoryData: NativeChildIsolationPathGrant | undefined,
) {
	if (!factoryData) return launcher;
	return { ...launcher, launch(request: NativeChildIsolationLaunchRequest) {
		return launcher.launch({ ...request, arguments: [...request.arguments, bundledSurgeDataArgument(factoryData)],
			readOnly: [...request.readOnly, factoryData] });
	} } as Launcher;
}

export function isBundledFactoryLaunch(request: Pick<NativeChildIsolationLaunchRequest, 'arguments' | 'readOnly'>,
	factoryData: NativeChildIsolationPathGrant | undefined): boolean {
	return factoryData !== undefined && request.arguments.length === 1 && request.arguments[0] === bundledSurgeDataArgument(factoryData)
		&& request.readOnly.some(grant => grant.kind === 'directory' && grant.path === factoryData.path
			&& grant.identity.dev === factoryData.identity.dev && grant.identity.ino === factoryData.identity.ino);
}
