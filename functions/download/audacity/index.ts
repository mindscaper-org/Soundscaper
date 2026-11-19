/* SPDX-License-Identifier: AGPL-3.0-only */

import { audacityDownloadLocale } from '../../../src/common/site/audacity-download/localization.ts';
import { renderAudacityDownloadPage } from '../../../src/common/site/audacity-download/page.ts';
import { currentDownloadReleases } from '../../../src/common/site/audacity-download/releases.ts';

export function onRequest(context: Readonly<{ request: Request }>): Promise<Response> {
	return handleAudacityDownloadRequest(context.request);
}

export async function handleAudacityDownloadRequest(request: Request, fetchImpl: typeof fetch = fetch): Promise<Response> {
	if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
	const url = new URL(request.url);
	const locale = audacityDownloadLocale(url.pathname);
	if (url.hostname !== 'soundscaper.org' || locale === null) return new Response(null, { status: 404 });
	const body = request.method === 'HEAD' ? null
		: await renderAudacityDownloadPage(locale, await currentDownloadReleases(fetchImpl), request.headers);
	return new Response(body, { headers: {
		'Content-Type': 'text/html; charset=utf-8', 'Content-Language': locale, 'Cache-Control': 'no-store',
		'Accept-CH': 'Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Mobile',
		'Critical-CH': 'Sec-CH-UA-Arch, Sec-CH-UA-Bitness',
		Vary: 'User-Agent, Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Mobile',
		'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
		'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
	} });
}
