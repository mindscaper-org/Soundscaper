/* SPDX-License-Identifier: AGPL-3.0-only */
import { BUNDLED_PLUGIN_RESOURCE_LIMIT, BUNDLED_PLUGIN_RESOURCE_BYTE_LIMIT, isBundledPluginResourcePath } from './bundled-native-plugins.ts';

export interface BundledPluginResource { readonly path: string; readonly byteLength: number; readonly sha256: string }

/** Native code remains in the existing 128-file closure; factory assets carry their own exact byte authority. */
export function validateBundledPluginResources(value: unknown, prefix: string): readonly BundledPluginResource[] {
	if (!Array.isArray(value) || value.length > BUNDLED_PLUGIN_RESOURCE_LIMIT) throw new TypeError('Bundled plug-in resources exceed their bounded inventory.');
	let total = 0;
	const paths = new Set<string>();
	return Object.freeze(value.map((entry: unknown) => {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)
			|| Object.keys(entry).sort().join(',') !== 'byteLength,path,sha256') throw new TypeError('Invalid bundled plug-in resource descriptor.');
		const resource = entry as BundledPluginResource;
		if (typeof resource.path !== 'string' || !resource.path.startsWith(prefix) || !isBundledPluginResourcePath(resource.path.slice(prefix.length))
			|| !Number.isSafeInteger(resource.byteLength) || resource.byteLength < 1 || !/^[a-f\d]{64}$/u.test(resource.sha256)
			|| paths.has(resource.path)) throw new TypeError('Invalid bundled plug-in resource identity.');
		paths.add(resource.path); total += resource.byteLength;
		if (total > BUNDLED_PLUGIN_RESOURCE_BYTE_LIMIT) throw new RangeError('Bundled plug-in resources exceed their total byte budget.');
		return Object.freeze({ ...resource });
	}));
}
