/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve an identity only if it cannot disclose a plug-in's filesystem path. */
export function publicStablePluginId(value: string): Readonly<{ stablePluginId?: string }> {
	return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(value) ? { stablePluginId: value } : {};
}
