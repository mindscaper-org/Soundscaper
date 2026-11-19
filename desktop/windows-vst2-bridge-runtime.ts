/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, join } from 'node:path';
import type { NativeChildIsolationArtifactDescriptor } from './native-child-isolation-contract.ts';
import { createNativePluginProcessLauncher } from './native-plugin-process-launcher.ts';
import { createSoundscaperProfessionalPluginPeer } from './soundscaper-professional-plugin-peer.ts';
import { createWindowsVst2BridgeRouter } from './windows-vst2-bridge-router.ts';

/** The bridge is a separately authenticated win-x64 payload role, not an app target. */
export function attachWindowsVst2Bridge(options: Readonly<{
	target: string;
	nativePeer: ReturnType<typeof createSoundscaperProfessionalPluginPeer>;
	nativeExecutable: NativeChildIsolationArtifactDescriptor;
	runtimeClosure: readonly NativeChildIsolationArtifactDescriptor[];
	artifacts: Parameters<typeof createNativePluginProcessLauncher>[0]['artifacts'];
}>) {
	const path = join(dirname(options.nativeExecutable.path), 'runtime', 'soundscaper_vst2_x86_peer.exe');
	const executable = options.runtimeClosure.find((artifact) => artifact.path === path);
	if (options.target !== 'win-x64' || !executable) return options.nativePeer;
	const launcher = createNativePluginProcessLauncher({ target: options.target,
		peerExecutable: executable, peerArchitecture: 'ia32', artifacts: options.artifacts });
	const bridgePeer = createSoundscaperProfessionalPluginPeer({ launcher, peerExecutable: executable,
		runtimeReadExecute: [], pluginFormats: ['vst2'] });
	return createWindowsVst2BridgeRouter({ nativePeer: options.nativePeer, bridgePeer, target: options.target });
}
