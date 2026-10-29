/* SPDX-License-Identifier: AGPL-3.0-only */

/** An opening frame must preserve focus handed to panel contents or a later interaction. */
export function focusOpenedWorkspacePanel(
	panel: HTMLElement | null,
	openingFocus: Element | null = panel?.ownerDocument.activeElement ?? null,
): void {
	if (!panel) return;
	const document = panel.ownerDocument, active = document.activeElement;
	if (panel.contains(active) || active !== openingFocus && active !== document.body && active !== document.documentElement) return;
	panel.tabIndex = -1;
	panel.focus({ preventScroll: false });
}
