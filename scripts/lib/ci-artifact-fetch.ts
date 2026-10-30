/* SPDX-License-Identifier: AGPL-3.0-only */

import { EnvHttpProxyAgent } from 'undici';

interface FetchScope {
	fetch: typeof globalThis.fetch;
}

const dispatchers = new WeakMap<FetchScope, EnvHttpProxyAgent>();

/** Keep CI archive transfers off the HTTP/2 path while retaining proxy and TLS policy. */
export function configureCiArtifactFetch(
	scope: FetchScope = globalThis,
	environment: NodeJS.ProcessEnv = process.env,
): EnvHttpProxyAgent | null {
	if (environment.CI !== 'true') return null;
	const installed = dispatchers.get(scope);
	if (installed) return installed;
	const dispatcher = new EnvHttpProxyAgent({
		allowH2: false,
		httpProxy: environment.http_proxy ?? environment.HTTP_PROXY,
		httpsProxy: environment.https_proxy ?? environment.HTTPS_PROXY,
		noProxy: environment.no_proxy ?? environment.NO_PROXY,
	});
	const nativeFetch = scope.fetch;
	scope.fetch = (input, init) => {
		const options = { dispatcher, ...init };
		return nativeFetch(input, options);
	};
	dispatchers.set(scope, dispatcher);
	return dispatcher;
}
