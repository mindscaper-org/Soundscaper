/* SPDX-License-Identifier: AGPL-3.0-only */

import { join } from 'node:path';

import { IPC, PRODUCT_ID } from './constants.js';
import { registerDesktopPluginDiscovery } from './plugin-registration.mjs';
import { DesktopSettingsStore } from './settings.js';
import { createTracktionPluginRuntime } from './tracktion-plugin-runtime.mjs';

/** Use the prepared app's verified plug-in payload and Tracktion's independent consent and settings. */
export async function startTracktionInstalledPlugins({ profile, parentWindow, resourcesPath }) {
	if (PRODUCT_ID !== 'soundscaper') throw new Error('Tracktion requires a prepared Soundscaper desktop runtime.');
	const settings = new DesktopSettingsStore(join(profile, 'settings.json'));
	await settings.load();
	const registration = registerDesktopPluginDiscovery({
		channels: IPC,
		// Discovery and host methods are main-owned. Tracktion has its own project IPC.
		handle: () => undefined,
		ownerFor: () => { throw new Error('Tracktion plug-ins require project authority.'); },
		settings, desktopRoot: import.meta.dirname, userDataPath: profile, parentWindow, resourcesPath, packaged: false,
	});
	try {
		await registration.ready();
		return { library: registration.tracktionEffects(createTracktionPluginRuntime), dispose: registration.dispose };
	} catch (error) {
		await registration.dispose();
		throw error;
	}
}
