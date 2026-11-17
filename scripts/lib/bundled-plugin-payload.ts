/* SPDX-License-Identifier: AGPL-3.0-only */
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { BUNDLED_SURGE_DATA_PATH, bundledNativePlugins, isBundledPluginResourcePath } from '../../desktop/bundled-native-plugins.ts';
import { validateBundledPluginResources, type BundledPluginResource } from '../../desktop/bundled-plugin-resources.ts';

interface CopiedArtifact extends BundledPluginResource { readonly absolutePath?: string }
interface Options {
	readonly target: string;
	readonly installRoot: string;
	readonly payloadRoot: string;
	readonly resultRoot: string;
	readonly copyArtifact: (source: string, destination: string, root: string, mode: number) => Promise<CopiedArtifact>;
}

/** One closed inventory owns app-provided code; factory data cannot consume or bypass its native-code budget. */
export async function copyBundledPluginPayload(options: Options) {
	const plugins = bundledNativePlugins(options.target);
	const nativePaths = new Set(plugins.map(plugin => plugin.binaryPath));
	const code: CopiedArtifact[] = [], resources: BundledPluginResource[] = [];
	const copy = async (path: string) => {
		const destination = join(options.payloadRoot, 'runtime', path);
		await mkdir(dirname(destination), { recursive: true });
		return options.copyArtifact(join(options.installRoot, 'runtime', path), destination, options.resultRoot, 0o444);
	};
	for (const plugin of plugins) code.push(await copy(plugin.binaryPath));
	for (const root of ['instruments', BUNDLED_SURGE_DATA_PATH]) {
		for (const path of await regularFiles(join(options.installRoot, 'runtime'), root)) {
			if (nativePaths.has(path)) continue;
			if (!isBundledPluginResourcePath(path)) throw new Error(`Unexpected bundled plug-in resource: ${path}`);
			const artifact = await copy(path);
			resources.push({ path: artifact.path, byteLength: artifact.byteLength, sha256: artifact.sha256 });
		}
	}
	resources.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	return Object.freeze({ code: Object.freeze(code), resources: validateBundledPluginResources(resources, 'payload/runtime/') });
}

async function regularFiles(root: string, directory: string): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
		const path = `${directory}/${entry.name}`;
		if (entry.name.includes('\\') || entry.name === '..' || entry.name === '.') throw new Error('Invalid bundled plug-in path.');
		const metadata = await lstat(join(root, path));
		if (metadata.isDirectory() && !metadata.isSymbolicLink()) result.push(...await regularFiles(root, path));
		else if (metadata.isFile() && !metadata.isSymbolicLink()) result.push(path);
		else throw new Error(`A bundled plug-in resource is symbolic or special: ${path}`);
	}
	return result;
}
