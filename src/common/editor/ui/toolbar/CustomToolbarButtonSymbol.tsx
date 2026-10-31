/* SPDX-License-Identifier: AGPL-3.0-only */
import React from 'react';
import { iconNameToChar } from '../../audacity-iconcodes.js';

/** Images stay in an image context: uploaded SVG is never inserted as markup. */
export default function CustomToolbarButtonSymbol({ icon, color }: { readonly icon: string; readonly color?: string }) {
	return icon.startsWith('data:image/')
		? <img className="kw-audio-editor-custom-button-symbol" src={icon} alt="" draggable={false} />
		: <span className="musescore-icon" aria-hidden="true" style={color ? { color } : undefined}>{iconNameToChar(icon)}</span>;
}
