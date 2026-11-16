/* SPDX-License-Identifier: AGPL-3.0-only */

export interface PluginPreset {
	readonly id: string;
	readonly effectType: string;
	readonly name: string;
	readonly params: Readonly<Record<string, unknown>>;
}
export interface PluginPresetLibrary {
	list(type: string): readonly PluginPreset[];
	save(options: Readonly<{ id?: string; effectType: string; name: string; params: Readonly<Record<string, unknown>> }>): Promise<PluginPreset>;
	delete(id: string): Promise<unknown>;
	import(input: string, options: Readonly<{ effectType: string; sourceName: string }>): Promise<unknown>;
	export(id: string): string;
}

/** A dialog owns one session. Retiring it fences delayed native reads and preset application. */
export function createPluginPresetSession(dependencies: {
	readonly effectType: string;
	readonly isCurrent?: () => boolean;
	readonly library: PluginPresetLibrary;
	readonly read: () => PromiseLike<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>;
	readonly apply: (params: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
}) {
	let active = true;
	let operation = 0;
	const current = (): boolean => active && dependencies.isCurrent?.() !== false;
	return {
		activate(): void { active = true; },
		dispose(): void { active = false; operation++; },
		async save(name: string, id?: string): Promise<PluginPreset | null> {
			const token = ++operation;
			if (!current()) return null;
			const params = structuredClone(await dependencies.read());
			if (!current() || token !== operation) return null;
			return await dependencies.library.save({ effectType: dependencies.effectType, name, params, ...(id ? { id } : {}) });
		},
		async apply(preset: PluginPreset): Promise<boolean> {
			if (!current() || preset.effectType !== dependencies.effectType) return false;
			++operation;
			await dependencies.apply(structuredClone(preset.params));
			return current();
		},
	};
}
