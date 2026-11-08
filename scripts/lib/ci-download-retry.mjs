/* SPDX-License-Identifier: AGPL-3.0-only */

// Bootstrap downloads run before npm ci; keep this module dependency-free.
import { setTimeout as delay } from 'node:timers/promises';
import { fetchGithubReleaseAsset, isTransientCiDownloadFailure } from './ci-github-release-fetch.mjs';

class DownloadResponseError extends Error {
	constructor(status) {
		super(`CI archive download failed: HTTP ${status}.`);
		this.status = status;
	}
}

/**
 * Retry only transport failures, consuming a fresh bounded body each time.
 * Callers authenticate the returned bytes against their existing source pins.
 * @param {string} url
 * @param {{maximumBytes: number, timeoutMs?: number, fetchImpl?: typeof fetch, wait?: (milliseconds: number) => Promise<unknown>}} options
 */
export async function downloadCiBytes(url, {
	maximumBytes, timeoutMs = 60_000, fetchImpl = globalThis.fetch, wait = delay,
}) {
	for (let attempt = 0; ; attempt += 1) {
		try {
			const response = await fetchGithubReleaseAsset(url, {
				redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
			}, { fetchImpl });
			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined);
				throw new DownloadResponseError(response.status);
			}
			const chunks = [];
			let received = 0;
			for await (const chunk of response.body) {
				received += chunk.byteLength;
				if (received > maximumBytes) throw new Error(`${url} sent more than its pinned ${maximumBytes} bytes.`);
				chunks.push(chunk);
			}
			return Buffer.concat(chunks);
		} catch (error) {
			if (!isTransientCiDownloadFailure(error) || attempt >= 2) throw error;
			await wait(500 * 2 ** attempt);
		}
	}
}
