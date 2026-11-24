/* SPDX-License-Identifier: AGPL-3.0-only */

import type { HelperEffectPluginFormat } from './helper-job-grant.ts';
import type { createSoundscaperProfessionalPluginPeer, ProfessionalPluginPeerContext } from './soundscaper-professional-plugin-peer.ts';
import type { TracktionOfflineEffectHost, TracktionOfflineEffectIdentity } from './tracktion-offline-effects.ts';

type ProfessionalPeer = Pick<ReturnType<typeof createSoundscaperProfessionalPluginPeer>,
	'openPluginInstance' | 'pluginAudioTopology' | 'pluginLatencyFrames' | 'processPluginBlock' | 'closePluginInstance'>;

interface InstalledEffect {
	readonly format: Exclude<HelperEffectPluginFormat, 'fixture'>;
	readonly stableId: string;
	readonly path: string;
	readonly context: ProfessionalPluginPeerContext;
}

/** The resolver must enforce the format gate, quarantine, and allowance before granting the selected installation. */
export function createTracktionProfessionalEffectHost(
	peer: ProfessionalPeer,
	resolveInstalledEffect: (identity: TracktionOfflineEffectIdentity) => Promise<InstalledEffect | null>,
): TracktionOfflineEffectHost {
	return {
		async openStereo(identity, sampleRate, maximumFrames) {
			const installed = await resolveInstalledEffect(identity);
			if (!installed || installed.format !== identity.format || installed.stableId !== identity.stableId
				|| installed.context.sha256 !== identity.sha256) return null;
			const instance = await peer.openPluginInstance(
				installed.path, sampleRate, maximumFrames, installed.format, installed.stableId, installed.context,
			);
			let closed = false;
			async function close(): Promise<void> {
				if (closed) return;
				closed = true;
				await peer.closePluginInstance(instance);
			}
			try {
				const { inputChannels, outputChannels } = peer.pluginAudioTopology(instance);
				if (inputChannels !== 2 || outputChannels !== 2) {
					await close();
					return null;
				}
				const latencyFrames = await peer.pluginLatencyFrames(instance);
				return {
					latencyFrames,
					async process(input, output) {
						const frames = input[0].length;
						if (closed || await peer.processPluginBlock(instance, frames, input, output) !== frames) {
							throw new Error('The isolated professional effect did not process the full Tracktion block.');
						}
					},
					close,
				};
			} catch (error) {
				await close();
				throw error;
			}
		},
	};
}
