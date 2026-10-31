/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopDownloadProductForHostname } from '../../src/common/editor/desktop-download-links.ts';
import { desktopDownloadEnvironmentForHeaders } from '../../src/common/editor/desktop-download-target.ts';
import { fetchDesktopReleases, selectLatestDesktopRc } from '../../src/common/site/desktop-releases.ts';
import { renderDownloadPage } from '../../src/common/site/download-page.ts';

/** Cloudflare Pages serves both /download and /download/. */
export function onRequest(context: Readonly<{ request: Request }>): Promise<Response> {
	return handleDownloadPageRequest(context.request);
}

export async function handleDownloadPageRequest(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	}
	const url = new URL(request.url);
	const productId = desktopDownloadProductForHostname(url.hostname);
	if (productId === null || !/^\/download\/?$/u.test(url.pathname)) return new Response(null, { status: 404 });
	let release = null;
	let unavailable = false;
	try {
		release = selectLatestDesktopRc(await fetchDesktopReleases(fetchImpl), productId);
	} catch (error) {
		unavailable = true;
		console.warn(JSON.stringify({ event: 'download_page_lookup_failed', productId,
			reason: error instanceof Error ? error.message : String(error) }));
	}
	const environment = desktopDownloadEnvironmentForHeaders(request.headers);
	return new Response(request.method === 'HEAD' ? null : renderDownloadPage(productId, release, unavailable, environment), {
		status: unavailable ? 503 : 200,
		headers: {
			'Content-Type': 'text/html; charset=utf-8',
			'Cache-Control': 'no-store',
			'Accept-CH': 'Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Mobile',
			'Critical-CH': 'Sec-CH-UA-Arch, Sec-CH-UA-Bitness',
			Vary: 'User-Agent, Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Mobile',
			'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
			'Referrer-Policy': 'no-referrer',
			'X-Content-Type-Options': 'nosniff',
			...(unavailable ? { 'Retry-After': '300' } : {}),
		},
	});
}
