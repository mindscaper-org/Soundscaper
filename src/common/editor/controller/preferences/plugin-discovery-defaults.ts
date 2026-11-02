/* SPDX-License-Identifier: AGPL-3.0-only */

interface PluginDiscoveryDefaultsPort {
	setEnabled(enabled: boolean): Promise<unknown>;
	nativePluginAvailability(): Promise<Readonly<{ consent: Readonly<{ formats: readonly Readonly<{
		format: string; supported: boolean; granted: boolean;
		roots: readonly Readonly<{ rootId: string; origin: string; admitted: boolean }>[];
	}>[] }> }>>;
	setNativePluginConsent(request: Readonly<{
		action: 'grant' | 'add-standard-root' | 'remove-root'; format: string; rootId?: string;
	}>): Promise<unknown>;
}

/** Stop active scans before replacing folder choices; plugin allowances and quarantine are retained. */
export async function restorePluginDiscoveryDefaults(port: PluginDiscoveryDefaultsPort): Promise<void> {
	await port.setEnabled(false);
	const availability = await port.nativePluginAvailability();
	for (const format of availability.consent.formats) {
		if (!format.supported) continue;
		await port.setNativePluginConsent({ action: 'grant', format: format.format });
		for (const root of format.roots) {
			if (root.origin !== 'standard' && !root.admitted) continue;
			await port.setNativePluginConsent({ action: root.origin === 'standard' ? 'add-standard-root' : 'remove-root',
				format: format.format, rootId: root.rootId });
		}
	}
	await port.setEnabled(true);
}
