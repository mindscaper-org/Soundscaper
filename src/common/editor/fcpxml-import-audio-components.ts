/* SPDX-License-Identifier: AGPL-3.0-only */
import type { XmlElement } from './dawproject-xml.ts';

export type FcpxmlAudioComponentState = 'muted' | 'omitted' | null;

/** Component mixes need per-channel/range routing; a raw source must never replace them. */
export function fcpxmlAudioComponentState(node: XmlElement): FcpxmlAudioComponentState {
	const components = node.children.filter(child => child.name === 'audio-channel-source' || child.name === 'audio-role-source');
	if (!components.length) return null;
	return components.every(component => component.attributes.enabled === '0' || component.attributes.active === '0') ? 'muted' : 'omitted';
}
