/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentPropsWithoutRef } from 'react';

import './EditorControlLabel.css';

/** Keep localized sentence case, acronyms, units and accessible names intact. */
export default function EditorControlLabel({ children, className, ...attributes }: ComponentPropsWithoutRef<'span'>) {
	return <span {...attributes} className={`audio-editor-control-label${className ? ` ${className}` : ''}`}>{children}</span>;
}
