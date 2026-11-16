/* SPDX-License-Identifier: AGPL-3.0-only */

import { effectAutoIdleEnabled, withEffectAutoIdleOverride } from '../../effect-auto-idle-preferences.ts';
import { useEffectPluginHeaderHost } from './effect-plugin-header-host.ts';

export function useEffectAutoIdleOption(controller: unknown, key: string, name: string,
	run: (operation: () => PromiseLike<unknown> | unknown) => unknown, realtime = true) {
	const { host, snapshot } = useEffectPluginHeaderHost(controller);
	const preferences = snapshot.preferences?.advanced;
	return {
		enabled: effectAutoIdleEnabled(preferences, key),
		disabled: !realtime || !host,
		onChange: (enabled: boolean): void => {
			if (!host || !realtime) return;
			run(() => host.actions.preferences.update({ advanced: {
				effectAutoIdleOverrides: withEffectAutoIdleOverride(host.getSnapshot().preferences?.advanced ?? {}, key, name, enabled),
			} }));
		},
	};
}
