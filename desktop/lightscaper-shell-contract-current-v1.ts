/* SPDX-License-Identifier: AGPL-3.0-only */

export const LIGHTSCAPER_SHELL_ORIGIN_CURRENT_V1 = 'lightscaper-app://bundle';
export const LIGHTSCAPER_SHELL_PARTITION_CURRENT_V1 = 'persist:lightscaper-production';
export const LIGHTSCAPER_SHELL_CHANNELS_CURRENT_V1 = Object.freeze({
	environment: 'lightscaper:v1:environment',
	ready: 'lightscaper:v1:renderer:ready',
	respond: 'lightscaper:v1:close:respond',
	closeRequested: 'lightscaper:v1:event:close-requested',
	menuCommand: 'lightscaper:v1:event:menu-command',
});
export interface LightscaperShellEnvironmentCurrentV1 {
	readonly productId: 'lightscaper';
	readonly platform: string;
	readonly arch: string;
	readonly version: string;
	readonly development: boolean;
	readonly locale: string;
}
export interface LightscaperCloseRequestCurrentV1 {
	readonly requestId: string;
	readonly reason: 'window-close' | 'quit';
}
export interface LightscaperCloseResponseCurrentV1 {
	readonly requestId: string;
	readonly allow: boolean;
}

/** Mirrors the existing main-document policy with the dedicated product's
 * exact authority; this pure check is also safe inside a sandbox preload. */
export function isLightscaperShellDocumentCurrentV1(candidate: string): boolean {
	try {
		const url = new URL(candidate);
		const authority = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)/u.exec(candidate)?.[1];
		return url.protocol === 'lightscaper-app:' && authority === 'bundle' && url.hostname === 'bundle'
			&& !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
	} catch { return false; }
}

export function readLightscaperCloseRequestCurrentV1(value: unknown): Readonly<LightscaperCloseRequestCurrentV1> {
	const record = closedRecord(value, ['requestId', 'reason']);
	const requestId = uuid(record.requestId);
	if (record.reason !== 'window-close' && record.reason !== 'quit') throw new TypeError('Invalid Lightscaper close reason.');
	return Object.freeze({ requestId, reason: record.reason });
}
export function readLightscaperCloseResponseCurrentV1(value: unknown): Readonly<LightscaperCloseResponseCurrentV1> {
	const record = closedRecord(value, ['requestId', 'allow']);
	const requestId = uuid(record.requestId);
	if (typeof record.allow !== 'boolean') throw new TypeError('Invalid Lightscaper close response.');
	return Object.freeze({ requestId, allow: record.allow });
}
export function readLightscaperEnvironmentCurrentV1(value: unknown): Readonly<LightscaperShellEnvironmentCurrentV1> {
	const record = closedRecord(value, ['productId', 'platform', 'arch', 'version', 'development', 'locale']);
	if (record.productId !== 'lightscaper' || typeof record.development !== 'boolean') throw new TypeError('Invalid Lightscaper environment.');
	return Object.freeze({ productId: 'lightscaper', platform: boundedText(record.platform, 32),
		arch: boundedText(record.arch, 16), version: boundedText(record.version, 128),
		development: record.development, locale: boundedText(record.locale, 32) });
}
export function readLightscaperMenuCommandCurrentV1(value: unknown): Readonly<{ command: 'preferences' }> {
	const record = closedRecord(value, ['command']);
	if (record.command !== 'preferences') throw new TypeError('Unknown Lightscaper native menu command.');
	return Object.freeze({ command: 'preferences' });
}
function closedRecord(value: unknown, fields: readonly string[]): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Lightscaper shell record.');
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Invalid Lightscaper shell record prototype.');
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError('Unknown Lightscaper shell record field.');
	}
	const captured: Record<string, unknown> = {};
	for (const key of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Lightscaper shell requires own data fields.');
		captured[key] = descriptor.value;
	}
	return Object.freeze(captured);
}
function boundedText(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value || value.length > maximum || /[\0\r\n]/u.test(value)) throw new TypeError('Invalid Lightscaper environment text.');
	return value;
}
function uuid(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value)) {
		throw new TypeError('Invalid Lightscaper close request identity.');
	}
	return value;
}
