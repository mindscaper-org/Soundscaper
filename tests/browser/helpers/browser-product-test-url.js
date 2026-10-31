/* SPDX-License-Identifier: AGPL-3.0-only */

export const BROWSER_PRODUCT_ORIGINS_VARIABLE = 'SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS';

/**
 * Resolve an editor route only when a test harness declares independent
 * product origins. Explicit URLs remain authoritative for packaged Electron
 * and the dedicated dual-origin suite.
 */
export function resolveBrowserProductTestUrl(path, environment = process.env) {
	if (typeof path !== 'string') throw new TypeError('A browser product test URL must be a string.');
	if (/^https?:\/\//u.test(path)) return path;
	const encoded = environment[BROWSER_PRODUCT_ORIGINS_VARIABLE];
	if (encoded === undefined || encoded === '') return path;
	const origins = browserProductOrigins(encoded);
	if (path === '/framescaper' || path.startsWith('/framescaper/')) {
		const canonicalPath = path.slice('/framescaper'.length) || '/';
		return new URL(canonicalPath, selectedOrigin(origins, 'framescaper')).href;
	}
	if (path.startsWith('/')) return new URL(path, selectedOrigin(origins, 'soundscaper')).href;
	return path;
}

function selectedOrigin(origins, product) {
	if (!origins[product]) throw new Error(`The ${product} origin was not selected for this browser run.`);
	return origins[product];
}

function browserProductOrigins(encoded) {
	let value;
	try {
		value = JSON.parse(encoded);
	} catch (error) {
		throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must be valid JSON.`, { cause: error });
	}
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
		throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name selected loopback product origins.`);
	}
	const origins = {};
	for (const productId of Object.keys(value)) {
		if (!['soundscaper', 'framescaper'].includes(productId)) throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} names an unknown product: ${productId}.`);
		let url;
		try {
			url = new URL(value[productId]);
		} catch (error) {
			throw new Error(
				`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name selected loopback product origins.`,
				{ cause: error },
			);
		}
		if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1'
			|| !url.port || url.pathname !== '/' || url.search || url.hash) {
			throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name selected loopback product origins.`);
		}
		origins[productId] = url.origin;
	}
	if (origins.soundscaper === origins.framescaper) {
		throw new Error(`${BROWSER_PRODUCT_ORIGINS_VARIABLE} must name distinct product origins.`);
	}
	return origins;
}
