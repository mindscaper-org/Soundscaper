/* SPDX-License-Identifier: AGPL-3.0-only */

/** Copy bounded JSON settings without invoking accessors or accepting executable objects. */
export function normalizePluginEffectPresetParams(value: unknown, maximumCharacters = 1048576): Record<string, unknown> {
	let nodes = 0;
	let characters = 0;
	const ancestors = new Set<object>();
	const copy = (input: unknown, depth: number): unknown => {
		if (++nodes > 100000 || depth > 16) throw new RangeError('Plug-in preset is too large or deeply nested.');
		if (input === null || typeof input === 'boolean') return input;
		if (typeof input === 'number' && Number.isFinite(input)) return input;
		if (typeof input === 'string') {
			characters += input.length;
			if (characters > maximumCharacters) throw new RangeError('Plug-in preset text is too large.');
			return input;
		}
		if (!input || typeof input !== 'object' || ancestors.has(input)
			|| !Array.isArray(input) && ![Object.prototype, null].includes(Object.getPrototypeOf(input) as object | null)) {
			throw new TypeError('Plug-in presets must contain plain JSON data.');
		}
		if (Array.isArray(input) && (Object.getPrototypeOf(input) !== Array.prototype || Object.keys(input).length !== input.length)) {
			throw new TypeError('Plug-in presets cannot contain sparse arrays.');
		}
		ancestors.add(input);
		const entries = Object.keys(input).map(key => {
			const field = Object.getOwnPropertyDescriptor(input, key)!;
			if (!Object.hasOwn(field, 'value')) throw new TypeError('Plug-in presets cannot contain accessors.');
			return [key, copy(field.value, depth + 1)] as const;
		});
		ancestors.delete(input);
		return Object.freeze(Array.isArray(input) ? entries.map(([, entry]) => entry) : Object.fromEntries(entries));
	};
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Plug-in preset settings must be an object.');
	return copy(value, 0) as Record<string, unknown>;
}
