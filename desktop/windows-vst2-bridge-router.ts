/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperPluginFormat } from './helper-job-grant.ts';
import type { ProfessionalPluginPeerContext } from './soundscaper-professional-plugin-peer.ts';
import { readAuthenticatedWindowsPluginArchitecture } from './windows-plugin-architecture.ts';

interface BridgeContext extends ProfessionalPluginPeerContext { readonly windowsX86Vst2?: true }
interface PluginPeer {
	inspectPluginCandidate(path: string, format: HelperPluginFormat, context: BridgeContext): Promise<readonly object[]>;
	openPluginInstance(path: string, sampleRate: number, maximumFrames: number,
		format: HelperPluginFormat, stableId: string, context: BridgeContext): Promise<object>;
}

/** All subsequent instance methods use the peer's existing session-bound RPC. */
export function createWindowsVst2BridgeRouter<Peer extends PluginPeer>(options: Readonly<{
	nativePeer: Peer; bridgePeer: Peer; target: string;
	readArchitecture?: typeof readAuthenticatedWindowsPluginArchitecture;
}>) {
	if (options.target !== 'win-x64') throw new TypeError('The x86 VST2 bridge requires Windows x64.');
	const { nativePeer, bridgePeer } = options;
	const readArchitecture = options.readArchitecture ?? readAuthenticatedWindowsPluginArchitecture;
	return Object.freeze({
		...nativePeer,
		inspectPluginCandidate: async (path: string, format: HelperPluginFormat, context: BridgeContext) => {
			if (format !== 'vst2') return nativePeer.inspectPluginCandidate(path, format, context);
			const architecture = await readArchitecture(path, context);
			if (architecture !== 'x64' && (architecture !== 'ia32' || context.windowsX86Vst2 !== true)) {
				return Object.freeze({ status: 'not-a-module', binaryArchitecture: architecture });
			}
			const peer = architecture === 'ia32' ? bridgePeer : nativePeer;
			return Object.freeze((await peer.inspectPluginCandidate(path, format, context))
				.map((description) => Object.freeze({ ...description, binaryArchitecture: architecture })));
		},
		openPluginInstance: async (path: string, sampleRate: number, maximumFrames: number,
			format: HelperPluginFormat, stableId: string, context: BridgeContext) => {
			if (format !== 'vst2') return nativePeer.openPluginInstance(path, sampleRate, maximumFrames, format, stableId, context);
			const architecture = await readArchitecture(path, context);
			if (architecture !== 'x64' && (architecture !== 'ia32' || context.windowsX86Vst2 !== true)) {
				throw new Error('The plugin architecture is incompatible or x86 VST2 bridge consent is disabled.');
			}
			return (architecture === 'ia32' ? bridgePeer : nativePeer)
				.openPluginInstance(path, sampleRate, maximumFrames, format, stableId, context);
		},
	});
}
