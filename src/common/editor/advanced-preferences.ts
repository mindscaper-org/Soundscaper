/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEffectMemoryLimitGiB } from './effect-memory-budget.ts';
import { normalizeEffectAutoIdleOverrides, type EffectAutoIdleOverride } from './effect-auto-idle-preferences.ts';

export const AUDIO_COM_DEFAULT_SERVER_URL = 'https://api.audio.com';

export interface AudioEditorAdvancedPreferences {
	readonly audioComServerUrl: string;
	readonly effectMemoryLimitGiB: number;
	readonly suspendIdleEffectProcessing: boolean;
	readonly effectAutoIdleOverrides: readonly EffectAutoIdleOverride[];
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Store an API origin, without allowing credentials or endpoint overrides. */
export function normalizeAudioComServerUrl(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError('audio.com server URL must be a URL.');
	let url: URL;
	try { url = new URL(value.trim()); }
	catch { throw new TypeError('audio.com server URL must be a URL.'); }
	if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
		|| url.hostname.endsWith('.') || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
		throw new RangeError('audio.com server URL must be an HTTPS origin, or HTTP loopback origin, without credentials, a path, query, or fragment.');
	}
	return url.origin;
}

export function normalizeAudioEditorAdvancedPreferences(value: unknown): AudioEditorAdvancedPreferences {
	if (value === undefined) value = {};
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
		throw new TypeError('advanced preferences must be a plain data object.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'audioComServerUrl' && key !== 'suspendIdleEffectProcessing' && key !== 'effectAutoIdleOverrides' && key !== 'effectMemoryLimitGiB')) {
		throw new TypeError('advanced preferences contain an unsupported field.');
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, 'audioComServerUrl');
	if (descriptor && (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))) {
		throw new TypeError('advanced.audioComServerUrl must be an enumerable data property.');
	}
	const memory = Object.getOwnPropertyDescriptor(value, 'effectMemoryLimitGiB');
	if (memory && (!memory.enumerable || !Object.hasOwn(memory, 'value'))) {
		throw new TypeError('advanced.effectMemoryLimitGiB must be an enumerable data property.');
	}
	const idle = Object.getOwnPropertyDescriptor(value, 'suspendIdleEffectProcessing');
	if (idle && (!idle.enumerable || !Object.hasOwn(idle, 'value') || typeof idle.value !== 'boolean')) {
		throw new TypeError('advanced.suspendIdleEffectProcessing must be an enumerable boolean data property.');
	}
	const overrides = Object.getOwnPropertyDescriptor(value, 'effectAutoIdleOverrides');
	if (overrides && (!overrides.enumerable || !Object.hasOwn(overrides, 'value'))) {
		throw new TypeError('Invalid auto-idle override preferences.');
	}
	return Object.freeze({
		effectMemoryLimitGiB: normalizeEffectMemoryLimitGiB(memory?.value),
		effectAutoIdleOverrides: normalizeEffectAutoIdleOverrides(overrides?.value),
		audioComServerUrl: normalizeAudioComServerUrl(descriptor ? descriptor.value : AUDIO_COM_DEFAULT_SERVER_URL),
		suspendIdleEffectProcessing: idle ? idle.value as boolean : true,
	});
}
