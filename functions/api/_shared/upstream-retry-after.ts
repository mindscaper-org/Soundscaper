/* SPDX-License-Identifier: AGPL-3.0-only */

/** Preserve the two HTTP Retry-After forms in provider error responses. */
export function safeUpstreamRetryAfter(value: string | null, maximumDelaySeconds = Number.MAX_SAFE_INTEGER): string | null {
	if (value === null || value.length > 64) return null;
	if (/^\d+$/u.test(value)) {
		const seconds = Number(value);
		return seconds <= maximumDelaySeconds ? String(seconds) : null;
	}
	// Admit the date shapes used by HTTP, including obsolete forms accepted by HTTP recipients.
	if (!/^(?:[A-Za-z]{3,9}, \d{2}[ -]|[A-Za-z]{3} [A-Za-z]{3} +\d{1,2} )/u.test(value)) return null;
	const date = Date.parse(value);
	return Number.isFinite(date) ? new Date(date).toUTCString() : null;
}
