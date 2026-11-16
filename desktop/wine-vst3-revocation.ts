/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DesktopPluginRegistry } from './plugin-registry.ts';
import type { PluginHostIsolationRegistry } from './plugin-host-isolation.ts';
import type { WineVst3Preferences } from './wine-vst3-preferences.ts';
import { wineVst3Module } from './wine-vst3-candidate.ts';

/** Reconfiguration withdraws Windows hosts while native Linux installations keep running. */
export async function changeWineVst3Configuration(wine: WineVst3Preferences, action: string,
	registry: DesktopPluginRegistry, isolation?: PluginHostIsolationRegistry): Promise<void> {
	const digests = new Set<string>();
	for (const entry of registry.describe().entries) {
		if (entry.format !== 'vst3') continue;
		for (const installation of entry.installations) {
			let grant;
			try { grant = registry.hostGrantFor(installation.installationId); }
			catch { continue; }
			try { if (!await wineVst3Module(grant.binaryPath)) continue; }
			catch { /* An installation that changed is withdrawn as well. */ }
			digests.add(grant.binarySha256);
			isolation?.revokeDigest(grant.binarySha256);
		}
	}
	try { await wine.action(action); }
	finally { if (wine.enabled) for (const digest of digests) isolation?.restoreDigest(digest); }
}
