/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityMacroParserFailure } from './audacity-macro-parser-failure.ts';

import {
	AUDACITY_EFFECT_MACRO_COMMANDS,
	parseAudacityEffectMacro,
} from './effect-macros.js';

interface ParsedMacroEffect {
	readonly type: string;
	readonly params: Readonly<Record<string, unknown>>;
}

interface ParsedMacro {
	readonly effects: readonly ParsedMacroEffect[];
	readonly ignoredCommands: readonly string[];
}

export interface AudacityEffectPresetImport {
	readonly effectType: string;
	readonly params: Readonly<Record<string, unknown>>;
}

/**
 * Parse the one-line text file written by Audacity's Export effect parameters
 * action. Audacity uses the same `Command:Name="value"` representation for an
 * exported preset and for one effect step in a macro, so the audited macro
 * parser remains the single owner of command IDs, parameter aliases, numeric
 * conversions and equalization curves.
 */
export function parseAudacityEffectPreset(
	text: string,
	expectedEffectType: string | null = null,
): AudacityEffectPresetImport {
	if (typeof text !== 'string') throw audacityMacroParserFailure(new TypeError('An Audacity effect preset must be text.'), 'TEXT');
	const source = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
	if (!source) throw audacityMacroParserFailure(new RangeError('The Audacity effect preset is empty.'), 'PRESET_LINE');
	if (/\r|\n/u.test(source)) throw audacityMacroParserFailure(new SyntaxError('An Audacity effect preset must contain exactly one effect line.'), 'PRESET_LINE');

	const parsed = parseAudacityEffectMacro(source, {
		idFactory: () => 'audacity-preset-import',
	}) as ParsedMacro;
	if (parsed.effects.length !== 1 || parsed.ignoredCommands.length) {
		throw audacityMacroParserFailure(new SyntaxError('An Audacity effect preset must contain exactly one supported effect.'), 'PRESET_LINE');
	}
	const effect = parsed.effects[0];
	if (!effect || !Object.hasOwn(AUDACITY_EFFECT_MACRO_COMMANDS, effect.type)) {
		throw audacityMacroParserFailure(new RangeError('The Audacity preset does not describe a ported effect.'), 'PRESET_EFFECT');
	}
	if (expectedEffectType && effect.type !== expectedEffectType) {
		throw audacityMacroParserFailure(new RangeError(`The Audacity preset is for a different effect (${effect.type}).`), 'PRESET_EFFECT');
	}
	return Object.freeze({ effectType: effect.type, params: effect.params });
}
