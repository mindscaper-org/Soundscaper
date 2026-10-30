/* SPDX-License-Identifier: AGPL-3.0-only */
import { componentCopyTemplate, type ComponentCopy } from '@soundscaper/design-system/component-copy';

export function localizedOverlapDescription(overlap: Readonly<{
	label: string; valid?: boolean; outgoingName?: string; incomingName?: string;
}>, copy: ComponentCopy): string {
	return overlap.outgoingName === undefined || overlap.incomingName === undefined ? overlap.label
		: componentCopyTemplate(overlap.valid === false ? copy.invalidVideoOverlap : copy.automaticCrossfade, { outgoing: overlap.outgoingName, incoming: overlap.incomingName });
}
