/* SPDX-License-Identifier: AGPL-3.0-only */

import { childElement, type XmlElement } from './dawproject-xml.ts';

/** Ardour 5+ moved special-route flags from Route into PresentationInfo. */
export function ardourRouteHasFlag(route: XmlElement, flag: 'MasterOut' | 'MonitorOut'): boolean {
	const flags = childElement(route, 'PresentationInfo')?.attributes.flags ?? route.attributes.flags ?? '';
	return flags.split(/[\s,]+/u).includes(flag);
}
