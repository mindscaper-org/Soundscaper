/* SPDX-License-Identifier: AGPL-3.0-only */
import { readMidiTrack } from '../../midi-model.ts';
import type { NativePluginRegistryView } from '../../native-plugin-host-contract.ts';

export interface MidiNativeInstrumentChoice { readonly installationId: string; readonly label: string }

export function hasSelectedMidiInstrumentTrack(controller: unknown): boolean {
	if (!controller || typeof controller !== 'object') return false;
	const owner = controller as { readonly project?: { readonly tracks?: readonly { readonly id?: unknown }[] };
		getSnapshot?: () => { readonly selectedTrackId?: unknown } };
	const id = typeof owner.getSnapshot === 'function' ? owner.getSnapshot().selectedTrackId : null;
	return readMidiTrack(owner.project?.tracks?.find(track => track.id === id)) !== null;
}

export function midiNativeInstrumentChoices(registry: NativePluginRegistryView, track: unknown): readonly MidiNativeInstrumentChoice[] {
	if (!readMidiTrack(track)) return [];
	return registry.entries.filter(entry => entry.classification === 'instrument' && ['vst2', 'vst3', 'lv2'].includes(entry.format.toLowerCase()))
		.flatMap(entry => entry.installations.filter(installation => installation.allowed && !installation.quarantined
			&& (entry.eligible || entry.ineligibleReason === 'identity-collision'))
			.map(installation => ({ installationId: installation.installationId,
				label: entry.installations.length > 1 ? `${entry.name} (${installation.version})` : entry.name })));
}
