/* SPDX-License-Identifier: AGPL-3.0-only */

// Native tooling also uses this before npm ci; keep it dependency-free.
const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_CODES = new Set([
	'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ERR_HTTP2_STREAM_ERROR',
	'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);
const METADATA_MAXIMUM_BYTES = 2 * 1024 * 1024;

export function isTransientCiDownloadFailure(error) {
	return TRANSIENT_STATUSES.has(error?.status) || error?.name === 'TimeoutError'
		|| TRANSIENT_CODES.has(error?.cause?.code ?? error?.code);
}

/** @param {unknown} input */
export function githubReleaseDownload(input) {
	if (typeof input !== 'string' && !(input instanceof URL)) return null;
	let url;
	try { url = new URL(input); } catch { return null; }
	if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash) return null;
	const match = /^\/([\w.-]+\/[\w.-]+)\/releases\/download\/(.+)\/([^/]+)$/u.exec(url.pathname);
	if (!match) return null;
	try {
		return { repository: match[1], tag: decodeURIComponent(match[2]), filename: decodeURIComponent(match[3]), url: url.href };
	} catch { return null; }
}

/**
 * A failing public download route can still serve the same asset via GitHub's
 * release API. Pin validation remains with the caller, after the transfer.
 * @param {Parameters<typeof fetch>[0]} input
 * @param {RequestInit | undefined} init
 * @param {{fetchImpl?: typeof fetch, token?: string}} [options]
 * @returns {Promise<Response>}
 */
export async function fetchGithubReleaseAsset(input, init, {
	fetchImpl = globalThis.fetch, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '',
} = {}) {
	const release = githubReleaseDownload(input);
	const canFallback = release && (init?.method ?? 'GET').toUpperCase() === 'GET';
	let response;
	try { response = await fetchImpl(input, init); }
	catch (error) {
		if (!canFallback || init?.signal?.aborted || !isTransientCiDownloadFailure(error)) throw error;
	}
	if (response && (!canFallback || !TRANSIENT_STATUSES.has(response.status))) return response;
	await response?.body?.cancel().catch(() => undefined);
	const headers = new Headers({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
	if (token) headers.set('Authorization', `Bearer ${token}`);
	const metadata = await fetchImpl(`https://api.github.com/repos/${release.repository}/releases/tags/${encodeURIComponent(release.tag)}`, {
		headers, signal: init?.signal ?? AbortSignal.timeout(30_000), redirect: 'error',
	});
	if (!metadata.ok) return metadata;
	const chunks = [];
	let received = 0;
	for await (const chunk of metadata.body) {
		received += chunk.byteLength;
		if (received > METADATA_MAXIMUM_BYTES) throw new Error('GitHub release metadata exceeds its byte limit.');
		chunks.push(chunk);
	}
	const document = JSON.parse(Buffer.concat(chunks).toString('utf8'));
	const assets = Array.isArray(document?.assets) ? document.assets.filter(asset => asset?.name === release.filename
		&& asset.browser_download_url === release.url && Number.isSafeInteger(asset.id) && asset.id > 0) : [];
	if (document?.tag_name !== release.tag || assets.length !== 1) throw new Error('GitHub metadata does not identify the exact release asset.');
	const assetHeaders = new Headers(init?.headers);
	assetHeaders.delete('Authorization');
	assetHeaders.set('Accept', 'application/octet-stream');
	assetHeaders.set('X-GitHub-Api-Version', '2022-11-28');
	if (token) assetHeaders.set('Authorization', `Bearer ${token}`);
	return fetchImpl(`https://api.github.com/repos/${release.repository}/releases/assets/${assets[0].id}`, {
		...init, headers: assetHeaders, redirect: 'follow',
	});
}
