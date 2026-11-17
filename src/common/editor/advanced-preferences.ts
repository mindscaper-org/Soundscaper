/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeEffectMemoryLimitGiB } from './effect-memory-budget.ts';

export const AUDIO_COM_DEFAULT_SERVER_URL = 'https://api.audio.com';

export interface AudioEditorAdvancedPreferences {
	readonly audioComServerUrl: string;
	readonly effectMemoryLimitGiB: number;
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
	if (value === undefined) return Object.freeze({ audioComServerUrl: AUDIO_COM_DEFAULT_SERVER_URL, effectMemoryLimitGiB: normalizeEffectMemoryLimitGiB() });
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) {
		throw new TypeError('advanced preferences must be a plain data object.');
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'audioComServerUrl' && key !== 'effectMemoryLimitGiB')) {
		throw new TypeError('advanced preferences contain an unsupported field.');
	}
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
		if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError(`advanced.${String(key)} must be an enumerable data property.`);
	}
	const server = Object.getOwnPropertyDescriptor(value, 'audioComServerUrl');
	return Object.freeze({
		audioComServerUrl: normalizeAudioComServerUrl(server ? server.value : AUDIO_COM_DEFAULT_SERVER_URL),
		effectMemoryLimitGiB: normalizeEffectMemoryLimitGiB(Object.getOwnPropertyDescriptor(value, 'effectMemoryLimitGiB')?.value),
	});
}
