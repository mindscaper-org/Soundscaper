/* SPDX-License-Identifier: AGPL-3.0-only */

interface PluginDiscoveryDefaultsPort {
	setEnabled(enabled: boolean): Promise<unknown>;
	nativePluginAvailability(): Promise<Readonly<{ consent: Readonly<{
		windowsX86Vst2?: Readonly<{ supported: boolean; enabled: boolean }>;
		linuxWineVst3?: Readonly<{ supported: boolean; enabled: boolean }>;
		formats: readonly Readonly<{
		format: string; supported: boolean; granted: boolean;
		roots: readonly Readonly<{ rootId: string; origin: string; admitted: boolean }>[];
	}>[] }> }>>;
	setNativePluginConsent(request: Readonly<{
		action: 'grant' | 'add-standard-root' | 'remove-root' | 'enable-x86-vst2' | 'disable-wine-vst3'; format: string; rootId?: string;
	}>): Promise<unknown>;
}

/** Stop active scans before replacing folder choices; plugin allowances and quarantine are retained. */
export async function restorePluginDiscoveryDefaults(port: PluginDiscoveryDefaultsPort): Promise<void> {
	await port.setEnabled(false);
	const availability = await port.nativePluginAvailability();
	if (availability.consent.windowsX86Vst2?.supported && !availability.consent.windowsX86Vst2.enabled) {
		await port.setNativePluginConsent({ action: 'enable-x86-vst2', format: 'vst2' });
	}
	if (availability.consent.linuxWineVst3?.enabled) {
		await port.setNativePluginConsent({ action: 'disable-wine-vst3', format: 'vst3' });
	}
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
