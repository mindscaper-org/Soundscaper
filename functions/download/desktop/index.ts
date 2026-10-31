/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	desktopDownloadProductForHostname,
	desktopReleaseSearchUrl,
} from '../../../src/common/editor/desktop-download-links.ts';
import {
	desktopDownloadTargetForAsset,
	desktopDownloadTargetForHeaders,
} from '../../../src/common/editor/desktop-download-target.ts';
import { fetchDesktopReleases, selectLatestDesktopRelease } from '../../../src/common/site/desktop-releases.ts';

/** Cloudflare Pages route at both /download/desktop and /download/desktop/. */
export function onRequest(context: Readonly<{ request: Request }>): Promise<Response> {
	return handleDesktopDownloadRequest(context.request);
}

export async function handleDesktopDownloadRequest(
	request: Request,
	fetchImpl: typeof fetch = fetch,
): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	}
	const url = new URL(request.url);
	const productId = desktopDownloadProductForHostname(url.hostname);
	if (productId === null) return new Response(null, { status: 404 });
	const isGeneric = /^\/download\/desktop\/?$/u.test(url.pathname);
	const asset = /^\/download\/desktop\/([^/]+)\/?$/u.exec(url.pathname)?.[1];
	const target = isGeneric ? desktopDownloadTargetForHeaders(request.headers)
		: asset ? desktopDownloadTargetForAsset(asset, productId) : null;
	if (!isGeneric && target === null) return new Response(null, { status: 404 });
	let destination: string | null = null;
	try {
		const releases = await fetchDesktopReleases(fetchImpl);
		destination = selectLatestDesktopRelease(releases, productId, target)
			?? selectLatestDesktopRelease(releases, productId);
	} catch (error) {
		console.warn(JSON.stringify({ event: 'desktop_release_lookup_failed', productId,
			reason: error instanceof Error ? error.message : String(error) }));
	}
	return new Response(null, {
		status: 302,
		headers: {
			Location: destination ?? desktopReleaseSearchUrl(productId),
			'Cache-Control': 'no-store',
			'Referrer-Policy': 'no-referrer',
			Vary: 'User-Agent, Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Mobile',
		},
	});
}
