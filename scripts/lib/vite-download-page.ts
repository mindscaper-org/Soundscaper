/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

import { handleDownloadPageRequest } from '../../functions/download/index.ts';
import type { DesktopDownloadProductId } from '../../src/common/editor/desktop-download-links.ts';

/** Vite does not execute Pages Functions; run the same page handler before its SPA fallback. */
export function localDownloadPagePlugin(productId: DesktopDownloadProductId, fetchImpl: typeof fetch = fetch): Plugin {
	const middleware: Connect.NextHandleFunction = (request, response, next) => {
		const url = new URL(request.url ?? '/', 'http://localhost');
		if (!/^\/download\/?$/u.test(url.pathname)) {
			next();
			return;
		}
		// Local builds take their product from SCAPE_PRODUCT, rather than a public hostname.
		const productUrl = `https://${productId}.org${url.pathname}${url.search}`;
		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
		}
		void respond(new Request(productUrl, { method: request.method, headers }), response, fetchImpl).catch(next);
	};
	return {
		name: 'scape-local-download-page',
		configureServer(server) { server.middlewares.use(middleware); },
		configurePreviewServer(server) { server.middlewares.use(middleware); },
	};
}

async function respond(request: Request, response: ServerResponse, fetchImpl: typeof fetch): Promise<void> {
	const result = await handleDownloadPageRequest(request, fetchImpl);
	const body = await result.text();
	response.writeHead(result.status, Object.fromEntries(result.headers));
	response.end(body);
}
