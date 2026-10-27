/* SPDX-License-Identifier: AGPL-3.0-only */
import { NYQUIST_BUNDLED_PLUGIN_CATALOG } from '../../nyquist/plugins/catalog.js';

interface ControlOption { readonly value: number; readonly label: string; readonly symbol?: string | null }
interface Control { readonly variable?: string | null; readonly label: string; readonly unit: string; readonly options: readonly ControlOption[] }
const bundled = new Set(NYQUIST_BUNDLED_PLUGIN_CATALOG.map(plugin => plugin.id));
function controlKey(pluginId: string, control: Control, index: number): string {
	return `${pluginId.replace(/^nyquist:/u, '')}.control.${control.variable ?? `note-${index}`}`;
}
/** Inventory derives from the pinned metadata while executable source stays untouched. */
export const NYQUIST_BUNDLED_CONTROL_COPY: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
	NYQUIST_BUNDLED_PLUGIN_CATALOG.flatMap(plugin => plugin.controls.flatMap((control, index) => {
		const key = controlKey(plugin.id, control, index);
		return [[`${key}.label`, control.label], [`${key}.unit`, control.unit], ...control.options.map(option => [`${key}.option.${option.value}`, option.label])]
			.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && /\p{L}/u.test(entry[1]));
	})),
));
export function localizeBundledNyquistControl<Value extends Control>(pluginId: string, control: Value, index: number, copy: Readonly<Record<string, string>>): Value & { readonly sourceUnit: string } {
	const key = controlKey(pluginId, control, index);
	const text = (suffix: string, fallback: string) => bundled.has(pluginId) ? copy[`${key}.${suffix}`] ?? fallback : fallback;
	return { ...control, sourceUnit: control.unit, label: text('label', control.label), unit: text('unit', control.unit),
		options: control.options.map(option => ({ ...option, label: text(`option.${option.value}`, option.label) })) } as Value & { readonly sourceUnit: string };
}
