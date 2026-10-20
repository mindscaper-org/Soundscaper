/* SPDX-License-Identifier: AGPL-3.0-only */
import { createBrowserCoverageObserverRoutes } from './browser-coverage-observer-routes.mjs';

/** @type {WeakMap<import('@playwright/test').BrowserContext, {owner:NonNullable<ReturnType<typeof createBrowserCoverageObserverRoutes>>;closed:boolean}>} */
const CONTEXTS = new WeakMap();

/** @param {{context:import('@playwright/test').BrowserContext;testFile:string;origin:string}} options */
export function createBrowserCoverageObserverInstallation({ context, testFile, origin }) {
	const owner = createBrowserCoverageObserverRoutes({ testFile, origin });
	if (!owner) return { owner: null, close() {} };
	if (CONTEXTS.has(context)) throw new Error('Observer installation already belongs to this context.');
	const state = { owner, closed: false }; CONTEXTS.set(context, state);
	/** @param {import('@playwright/test').Request} request */
	const navigation = request => { if (!state.closed && request.isNavigationRequest()) owner.navigationStarted(); };
	context.on('request', navigation);
	return { owner, close() { state.closed = true; context.off('request', navigation); CONTEXTS.delete(context); owner.close(); } };
}

/** Install the exact admitted body and coverage exclusion together, before navigation.
 * @param {import('@playwright/test').Page} page @param {string} pathname @param {string} source
 */
export async function installLightscaperGpuObserverRoute(page, pathname, source) {
	const state = CONTEXTS.get(page.context());
	if (!state || state.closed || page.url() !== 'about:blank') throw new Error('Observer route requires its own initial blank test page.');
	const url = state.owner.register(pathname, source);
	try { await page.route(url, route => route.fulfill({ contentType: 'text/javascript', body: source })); }
	catch (error) { state.closed = true; state.owner.close(); throw error; }
}
