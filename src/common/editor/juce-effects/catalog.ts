/* SPDX-License-Identifier: AGPL-3.0-only */

import catalog from './catalog.json' with { type: 'json' };

export interface JuceEffectParameter {
	readonly name: string;
	readonly unit: string;
	readonly min: number;
	readonly max: number;
	readonly initial: number;
	readonly logarithmic?: boolean;
	readonly choices?: readonly string[];
}

export interface JuceEffectDefinition {
	readonly kind: string;
	readonly code: number;
	readonly id: string;
	readonly label: string;
	readonly stablePluginId: string;
	readonly menuId: string;
	readonly pluginName: string;
	readonly parameters: readonly Readonly<JuceEffectParameter>[];
}

/** CMake derives native descriptors and parameters from this same catalogue. */
export const JUCE_EFFECTS: readonly Readonly<JuceEffectDefinition>[] = Object.freeze(catalog.map(effect => Object.freeze({
	...effect,
	stablePluginId: `org.soundscaper.juce.${effect.id}`,
	menuId: `juce-effect-${effect.id}`,
	pluginName: `JUCE ${effect.label}`,
	parameters: Object.freeze(effect.parameters.map(parameter => Object.freeze({ ...parameter,
		...('choices' in parameter ? { choices: Object.freeze([...(parameter.choices ?? [])]) } : {}),
	}))),
})));

export function juceEffectById(stablePluginId: unknown): Readonly<JuceEffectDefinition> | null {
	return JUCE_EFFECTS.find(effect => effect.stablePluginId === stablePluginId) ?? null;
}

export function juceEffectLabel(effect: Readonly<JuceEffectDefinition>, copy: Readonly<Record<string, string | undefined>> = {}): string {
	const key = `juce${effect.kind[0]?.toUpperCase()}${effect.kind.slice(1)}`;
	return copy[`ui.soundscaperNative.${key}`] ?? effect.label;
}
