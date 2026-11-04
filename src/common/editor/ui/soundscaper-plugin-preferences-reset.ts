/* SPDX-License-Identifier: AGPL-3.0-only */
import { restorePluginDiscoveryDefaults } from '../controller/preferences/plugin-discovery-defaults.ts';
import { type DesktopNativeTierControlsBridge, desktopNativeTierControlsStoreFor } from './desktop-host-menu.ts';
import { resolveSoundscaperNativeServicesBridge, soundscaperNativeServicesStoreFor } from './soundscaper-native-services-bridge.ts';

export async function resetSoundscaperPluginPreferences(productId: string, controls: DesktopNativeTierControlsBridge | null): Promise<void> {
	if (productId !== 'soundscaper') return;
	const bridge = resolveSoundscaperNativeServicesBridge();
	if (bridge === null || controls === null) return;
	const store = desktopNativeTierControlsStoreFor(controls);
	try {
		await restorePluginDiscoveryDefaults({
			setEnabled: (enabled) => store.apply('set-native-effect-discovery-enabled', enabled),
			nativePluginAvailability: () => bridge.nativePluginAvailability(),
			setNativePluginConsent: (request) => bridge.setNativePluginConsent(request),
		});
	} finally {
		await soundscaperNativeServicesStoreFor(bridge).refresh();
	}
}
