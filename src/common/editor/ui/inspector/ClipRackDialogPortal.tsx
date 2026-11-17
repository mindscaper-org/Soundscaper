/* SPDX-License-Identifier: AGPL-3.0-only */
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/** Clip properties contain scrolling and stacking contexts; settings windows escape them. */
export default function ClipRackDialogPortal({ anchor, children }: {
	readonly anchor: HTMLElement | null;
	readonly children: ReactNode;
}) {
	const host = anchor?.closest('[data-audio-editor]');
	return host ? createPortal(<div data-effects-window-host>{children}</div>, host) : children;
}
