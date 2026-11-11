/* SPDX-License-Identifier: AGPL-3.0-only */
export const UPDATE_PREFERENCES_CHANNEL = 'soundscaper:v1:updates:preferences';
export interface UpdatePreferences { readonly available: boolean; readonly enabled: boolean }
interface UpdateSettings {
	snapshot(): { readonly updatesEnabled: boolean };
	setUpdatesEnabled(enabled: boolean): Promise<boolean>;
}
export async function updatePreferences(settings: UpdateSettings, available: boolean, enabled?: unknown): Promise<UpdatePreferences> {
	if (enabled !== undefined && typeof enabled !== 'boolean') throw new TypeError('Update preference must be a boolean.');
	if (available && typeof enabled === 'boolean') await settings.setUpdatesEnabled(enabled);
	return { available, enabled: available && settings.snapshot().updatesEnabled };
}
export function createUpdatePreferencesPreload(invoke: (channel: string, enabled?: boolean) => Promise<unknown>) {
	return {
		updatePreferences: async (enabled?: boolean): Promise<UpdatePreferences> => {
			if (enabled !== undefined && typeof enabled !== 'boolean') throw new TypeError('Update preference must be a boolean.');
			const value = await invoke(UPDATE_PREFERENCES_CHANNEL, enabled);
			if (!value || typeof value !== 'object' || !('available' in value) || typeof value.available !== 'boolean'
				|| !('enabled' in value) || typeof value.enabled !== 'boolean') throw new TypeError('Invalid update preferences.');
			return Object.freeze({ available: value.available, enabled: value.available && value.enabled });
		},
	};
}
