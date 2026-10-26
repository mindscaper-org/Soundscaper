/* SPDX-License-Identifier: AGPL-3.0-only */

export type CorridorKeyHintSettings = Readonly<{ settingsVersion: 1; hintMode: 'none' }> | Readonly<{
	settingsVersion: 1; hintMode: 'chroma-key'; keyColor: number;
	similarity: number; softness: number; hintQuality: number;
}>;

export const CORRIDORKEY_CHROMA_HINT_DEFAULTS: Extract<CorridorKeyHintSettings, { hintMode: 'chroma-key' }> = Object.freeze({ settingsVersion: 1 as const,
	hintMode: 'chroma-key' as const, keyColor: 0x00ff00, similarity: 0.1, softness: 0.1, hintQuality: 0.75 });

/** The same closed settings cross renderer, main, preload and worker boundaries. */
export function normalizeCorridorKeyHintSettings(value: unknown): CorridorKeyHintSettings {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid CorridorKey hint settings.');
	const input = value as Readonly<Record<string, unknown>>;
	const keys = input.hintMode === 'none' ? ['settingsVersion', 'hintMode']
		: ['settingsVersion', 'hintMode', 'keyColor', 'similarity', 'softness', 'hintQuality'];
	if (Reflect.ownKeys(input).length !== keys.length || Reflect.ownKeys(input).some((key) => !keys.includes(String(key)))
		|| input.settingsVersion !== 1) throw new TypeError('Unsupported CorridorKey hint settings.');
	if (input.hintMode === 'none') return Object.freeze({ settingsVersion: 1, hintMode: 'none' });
	if (input.hintMode !== 'chroma-key' || !Number.isSafeInteger(input.keyColor)
		|| Number(input.keyColor) < 0 || Number(input.keyColor) > 0xffffff) throw new TypeError('Invalid Chroma Key hint color.');
	for (const field of ['similarity', 'softness', 'hintQuality'] as const) {
		const number = input[field];
		if (typeof number !== 'number' || !Number.isFinite(number) || number < (field === 'similarity' ? 0.01 : 0) || number > 1) {
			throw new TypeError(`Invalid Chroma Key hint ${field}.`);
		}
	}
	return Object.freeze({ settingsVersion: 1, hintMode: 'chroma-key', keyColor: Number(input.keyColor),
		similarity: Number(input.similarity), softness: Number(input.softness), hintQuality: Number(input.hintQuality) });
}
