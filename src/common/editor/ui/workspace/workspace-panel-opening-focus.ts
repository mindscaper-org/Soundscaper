/* SPDX-License-Identifier: AGPL-3.0-only */

/** An opening frame must preserve focus handed to panel contents or a later interaction. */
export function focusOpenedWorkspacePanel(
	panel: HTMLElement | null,
	openingFocus: Element | null = panel?.ownerDocument.activeElement ?? null,
): void {
	if (!panel) return;
	const document = panel.ownerDocument, active = document.activeElement;
	// Closing the compact menu drawer returns focus to its toggle before this frame.
	const drawerId = openingFocus?.closest('.kw-audio-editor__chrome-drawer-panel')?.getAttribute('id');
	const returnedToDrawerToggle = drawerId && active?.hasAttribute('data-chrome-drawer-toggle')
		&& active.getAttribute('aria-controls') === drawerId;
	if (panel.contains(active) || active !== openingFocus && !returnedToDrawerToggle
		&& active !== document.body && active !== document.documentElement) return;
	panel.tabIndex = -1;
	panel.focus({ preventScroll: false });
}
