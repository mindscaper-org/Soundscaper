/* SPDX-License-Identifier: AGPL-3.0-only */

export interface EffectAutoIdleOverride {
	readonly key: string;
	readonly name: string;
	readonly enabled: boolean;
}

export interface EffectAutoIdlePreferences {
	readonly suspendIdleEffectProcessing?: boolean;
	readonly effectAutoIdleOverrides?: readonly EffectAutoIdleOverride[];
}

export function normalizeEffectAutoIdleOverrides(value: unknown): readonly EffectAutoIdleOverride[] {
	if (value === undefined) return Object.freeze([]);
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 4096
		|| Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError('Invalid auto-idle overrides.');
	const keys = new Set<string>();
	return Object.freeze(Array.from({ length: value.length }, (_, index) => {
		const item = Object.getOwnPropertyDescriptor(value, index);
		if (!item?.enumerable || !Object.hasOwn(item, 'value')) throw new TypeError('Invalid auto-idle override entry.');
		const entry: unknown = item.value;
		if (!entry || typeof entry !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(entry) as object | null)
			|| Reflect.ownKeys(entry).some(key => key !== 'key' && key !== 'name' && key !== 'enabled')) {
			throw new TypeError('Invalid auto-idle override.');
		}
		const field = (key: string): unknown => {
			const descriptor = Object.getOwnPropertyDescriptor(entry, key);
			if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Invalid auto-idle override field.');
			return descriptor.value;
		};
		const key = field('key'), name = field('name'), enabled = field('enabled');
		if (typeof key !== 'string' || !key.trim() || key.length > 2048 || key.includes('\0') || keys.has(key)
			|| typeof name !== 'string' || !name.trim() || name.length > 1024 || typeof enabled !== 'boolean') {
			throw new TypeError('Invalid auto-idle override value.');
		}
		keys.add(key);
		return Object.freeze({ key, name, enabled });
	}));
}

export function effectAutoIdleEnabled(preferences: EffectAutoIdlePreferences | undefined, key: string): boolean {
	return preferences?.effectAutoIdleOverrides?.find(entry => entry.key === key)?.enabled
		?? preferences?.suspendIdleEffectProcessing !== false;
}

/** Null restores inheritance; a choice equal to the global default remains an explicit override. */
export function withEffectAutoIdleOverride(preferences: EffectAutoIdlePreferences, key: string, name: string,
	enabled: boolean | null): readonly EffectAutoIdleOverride[] {
	const entries = preferences.effectAutoIdleOverrides ?? [];
	const next = entries.filter(entry => entry.key !== key);
	if (enabled !== null) next.push({ key, name, enabled });
	return normalizeEffectAutoIdleOverrides(next);
}
