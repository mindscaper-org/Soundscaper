/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticateYabridgePayload } from './yabridge-payload.ts';
import { createWinePluginLauncher } from './wine-plugin-launcher.ts';
import { createSoundscaperProfessionalPluginPeer } from './soundscaper-professional-plugin-peer.ts';
import { createWineVst3Router, prepareWineVst3Bundle } from './wine-vst3-candidate.ts';
import type { WineVst3RuntimeConfiguration } from './wine-vst3-preferences.ts';
import type { NativeChildIsolationArtifactDescriptor } from './native-child-isolation-contract.ts';
import type { WineVst3Context } from './wine-vst3-candidate.ts';
import type { HelperPluginFormat } from './helper-job-grant.ts';

/** Called only inside a dedicated plugin helper with main-owned runtime configuration. */
export async function attachWineVst3Bridge(options: Readonly<{
	nativePeer: ReturnType<typeof createSoundscaperProfessionalPluginPeer>;
	peerExecutable: NativeChildIsolationArtifactDescriptor;
	entryExecutable: NativeChildIsolationArtifactDescriptor;
	entryArguments: readonly string[];
	runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[];
	configuration: Readonly<{ configurationPath: string }>;
}>) {
	const current = async () => {
		const handle = await open(options.configuration.configurationPath, 'r');
		let configuration: WineVst3RuntimeConfiguration | null;
		try {
			if ((await handle.stat()).size > 64 * 1024) throw new Error('The Wine runtime configuration is oversized.');
			configuration = JSON.parse(await handle.readFile('utf8')) as WineVst3RuntimeConfiguration | null;
		} finally { await handle.close(); }
		if (!configuration) throw new Error('Windows VST3 hosting is disabled or Wine/yabridge is unavailable.');
		return createPeer(configuration);
	};
	const createPeer = async (configuration: WineVst3RuntimeConfiguration) => {
		const payload = await authenticateYabridgePayload(configuration.manifest, configuration.runtimeRoot);
		const launcher = createWinePluginLauncher({ ...options, artifacts: payload.artifacts, wine: configuration.wine });
		return createSoundscaperProfessionalPluginPeer({ launcher, peerExecutable: options.peerExecutable,
			entryExecutable: options.entryExecutable, entryArguments: options.entryArguments,
			runtimeReadExecute: options.runtimeClosure, pluginFormats: ['vst3'],
			prepareCandidate: async (path, context) => {
				const root = await mkdtemp(join(tmpdir(), 'soundscaper-wine-'));
				try {
					const candidate = await prepareWineVst3Bundle(path, context, {
						libraryPath: join(payload.directory, 'libyabridge-vst3.so'), scratchRoot: root,
						librarySha256: payload.artifacts.find(({ path: file }) => file.endsWith('/libyabridge-vst3.so'))!.sha256,
					});
					return { ...candidate, dispose: () => rm(root, { recursive: true, force: true }) };
				} catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
			},
		});
	};
	const winePeer = {
		inspectPluginCandidate: async (path: string, format: HelperPluginFormat, context: WineVst3Context) =>
			(await current()).inspectPluginCandidate(path, format, context),
		openPluginInstance: async (path: string, rate: number, frames: number, format: HelperPluginFormat,
			id: string, context: WineVst3Context) => (await current()).openPluginInstance(path, rate, frames, format, id, context),
	};
	return createWineVst3Router({ target: 'linux-x64', nativePeer: options.nativePeer, winePeer });
}
