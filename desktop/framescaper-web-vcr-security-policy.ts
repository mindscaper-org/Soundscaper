/* SPDX-License-Identifier: AGPL-3.0-only */

export const FRAMESCAPER_WEB_VCR_URL_LIMIT = 2_048;
export const FRAMESCAPER_WEB_VCR_POPUP_LIMIT = 4;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export interface FramescaperWebVcrAdmittedUrl {
	readonly url: string;
}

/** Admits top-level and popup destinations without provider-specific exceptions. */
export function admitFramescaperWebVcrUrl(value: unknown): Readonly<FramescaperWebVcrAdmittedUrl> {
	if (typeof value !== 'string' || value.length === 0 || value.length > FRAMESCAPER_WEB_VCR_URL_LIMIT) {
		throw new TypeError('Web VCR URL must be a bounded string.');
	}
	if (value !== value.trim() || CONTROL_CHARACTER.test(value)) {
		throw new TypeError('Web VCR URL contains whitespace or control characters.');
	}
	if (value === 'about:blank') return Object.freeze({ url: value });
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new TypeError('Web VCR URL is invalid.');
	}
	if (parsed.protocol !== 'https:' || !parsed.hostname) {
		throw new TypeError('Web VCR navigation requires HTTPS.');
	}
	if (parsed.username || parsed.password) {
		throw new TypeError('Web VCR URLs cannot contain credentials.');
	}
	if (parsed.href.length > FRAMESCAPER_WEB_VCR_URL_LIMIT) {
		throw new TypeError('Canonical Web VCR URL exceeds the length limit.');
	}
	return Object.freeze({ url: parsed.href });
}

/** The guest profile has no permission allowlist; capture is granted to the trusted app instead. */
export function framescaperWebVcrPermissionAllowed(_permission: string): false {
	return false;
}

export function cancelFramescaperWebVcrDownload(
	event: Readonly<{ preventDefault(): void }>,
	item: Readonly<{ cancel(): void }>,
): void {
	if (!event || typeof event.preventDefault !== 'function' || !item || typeof item.cancel !== 'function') {
		throw new TypeError('Web VCR download denial requires Electron event and item seams.');
	}
	event.preventDefault();
	item.cancel();
}

export function webVcrPopupAllowed(value: Readonly<{
	readonly url: string;
	readonly phase: string;
	readonly openPopupCount: number;
}>): boolean {
	if (!value || typeof value !== 'object' || value.phase !== 'ready'
		|| !Number.isSafeInteger(value.openPopupCount) || value.openPopupCount < 0
		|| value.openPopupCount >= FRAMESCAPER_WEB_VCR_POPUP_LIMIT) return false;
	try {
		const admitted = admitFramescaperWebVcrUrl(value.url);
		return admitted.url !== 'about:blank';
	} catch {
		return false;
	}
}
