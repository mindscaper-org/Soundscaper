/* SPDX-License-Identifier: AGPL-3.0-only */

const FORMATS = new Set(['vst3', 'vst2', 'clap', 'au', 'lv2', 'ladspa', 'nyquist', 'vamp', 'generator', 'selection']);

/** Stable library/preference identity; never an instance, binary version, or install path. */
export function pluginEffectType(format: string, identifier: string): string {
	if (!FORMATS.has(format) || !identifier.trim() || identifier.length > 1024 || identifier.includes('\0')) {
		throw new TypeError('Invalid plug-in preset identity.');
	}
	return `plugin:${JSON.stringify([format, identifier])}`;
}

export function isPluginEffectType(value: string): boolean {
	if (!value.startsWith('plugin:')) return false;
	try {
		const identity: unknown = JSON.parse(value.slice(7));
		return Array.isArray(identity) && identity.length === 2
			&& typeof identity[0] === 'string' && typeof identity[1] === 'string'
			&& pluginEffectType(identity[0], identity[1]) === value;
	} catch { return false; }
}

export function effectPluginKey(effect: Readonly<{ type?: string; context?: unknown }>): string {
	if (effect.type === 'eq' || effect.type === 'parametric_eq') return 'parametric-eq';
	if (effect.type !== 'native-plugin') return effect.type ?? "";
	const context = effect.context as { format?: unknown; stablePluginId?: unknown } | null | undefined;
	return typeof context?.format === 'string' && typeof context.stablePluginId === 'string'
		? pluginEffectType(context.format, context.stablePluginId) : effect.type;
}
