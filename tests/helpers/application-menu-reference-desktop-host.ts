/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDesktopHostMenuItems } from '../../src/common/editor/ui/desktop-host-menu.ts';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';

export function richDesktopHost(productId: 'soundscaper' | 'framescaper', productName: string) {
	const noop = () => undefined;
	return createDesktopHostMenuItems({
		copy: ENGLISH_COPY,
		development: true,
		platform: 'linux',
		productId,
		productName,
		snapshot: {
			probeHelperEnabled: true,
			probeHelperQuarantined: true,
			audioHelperEnabled: true,
			audioHelperQuarantined: true,
			nativeEffectDiscoveryEnabled: true,
		},
		applyNativeTierControl: noop,
		runWindowAction: noop,
		checkForUpdates: noop,
		openExternal: noop,
		openMcpConnection: productId === 'soundscaper' ? noop : undefined,
	});
}

