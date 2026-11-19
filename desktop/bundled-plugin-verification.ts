/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { readdir } from 'node:fs/promises';
import { bundledNativePlugins, isSoundscaperOnlyBundledPluginArtifactPath } from './bundled-native-plugins.ts';
import type { VerifiedBundledPlugin } from './bundled-plugin-defaults.ts';

interface Artifact { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface Payload {
	readonly pluginOnly?: boolean;
	readonly target: string;
	readonly pluginPeer: Artifact;
	readonly isolation: { readonly runtimeClosure: readonly Artifact[]; readonly pluginResources: readonly Artifact[] };
}
interface Candidate { readonly byteLength: number; readonly sha256: string }

/** Reconcile the complete bundle fingerprint with the already authenticated package inventory before scanning it. */
export async function verifyBundledPluginCandidates(payload: Payload,
	authenticate: (path: string) => Promise<Candidate>,
): Promise<readonly VerifiedBundledPlugin[]> {
	const runtimeRoot = resolve(dirname(payload.pluginPeer.path), 'runtime');
	const plugins = bundledNativePlugins(payload.target).filter(plugin => !payload.pluginOnly
		|| !isSoundscaperOnlyBundledPluginArtifactPath(`runtime/${plugin.binaryPath}`));
	const artifacts = [...payload.isolation.runtimeClosure, ...payload.isolation.pluginResources];
	for (const directory of new Set(plugins.map(plugin => dirname(plugin.bundlePath)))) {
		const expected = plugins.filter(plugin => dirname(plugin.bundlePath) === directory);
		const entries = await readdir(resolve(runtimeRoot, directory), { withFileTypes: true });
		if (entries.length !== expected.length || entries.some(entry => {
			const plugin = expected.find(plugin => basename(plugin.bundlePath) === entry.name);
			return !plugin || (plugin.format === 'clap' ? !entry.isFile() : !entry.isDirectory());
		})) throw new Error('The bundled plug-in directory does not match its authenticated inventory.');
	}
	const verified: VerifiedBundledPlugin[] = [];
	for (const plugin of plugins) {
		const binaryPath = resolve(runtimeRoot, plugin.bundlePath), nativePath = resolve(runtimeRoot, plugin.binaryPath);
		if (!payload.isolation.runtimeClosure.some(artifact => artifact.path === nativePath)) throw new Error(`Missing bundled ${plugin.name} native authority.`);
		const files = plugin.format === 'clap' ? artifacts.filter(artifact => artifact.path === binaryPath)
			: artifacts.filter(artifact => artifact.path.startsWith(binaryPath + sep));
		files.sort((left, right) => relative(binaryPath, left.path).localeCompare(relative(binaryPath, right.path), 'en'));
		const hash = createHash('sha256'); hash.update('soundscaper-plugin-bundle-sha256-v1\0');
		for (const file of files) hash.update(`${relative(binaryPath, file.path).split(sep).join('/')}\0${file.byteLength}\0${file.sha256}\n`);
		const expected = plugin.format === 'clap' ? files[0]!
			: { sha256: hash.digest('hex'), byteLength: files.reduce((total, file) => total + file.byteLength, 0) };
		const actual = await authenticate(binaryPath);
		if (!expected || actual.sha256 !== expected.sha256 || actual.byteLength !== expected.byteLength) throw new Error(`The bundled ${plugin.name} bytes differ from the package authority.`);
		verified.push(Object.freeze({ ...plugin, binaryPath, byteLength: actual.byteLength, sha256: actual.sha256 }));
	}
	return Object.freeze(verified);
}
