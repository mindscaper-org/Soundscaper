/* SPDX-License-Identifier: AGPL-3.0-only */
import type { NativePluginEntryView } from '../native-plugin-host-contract.ts';
import { juceEffectById } from './catalog.ts';

/** Select by scanned identity; a plug-in's display name is not its identity. */
export function findJuceEffectEntry(entries: readonly NativePluginEntryView[], stablePluginId: unknown): NativePluginEntryView | undefined {
	if (!juceEffectById(stablePluginId)) return undefined;
	return entries.find(entry => entry.format.toLowerCase() === 'clap' && entry.stablePluginId === stablePluginId);
}
