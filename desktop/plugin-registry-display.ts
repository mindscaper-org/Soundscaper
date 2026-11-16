/* SPDX-License-Identifier: AGPL-3.0-only */

/** Scanner text remains bounded and pathless at the renderer boundary. */
export function displayText(value: string): string {
	return value.split(/[\\/]/u).join(' ').replace(/\s+/gu, ' ').trim() || '(unnamed)';
}

/** Preserve an identity only if it cannot disclose a plug-in's filesystem path. */
export function publicStablePluginId(value: string): Readonly<{ stablePluginId?: string }> {
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value) ? { stablePluginId: value } : {};
}
