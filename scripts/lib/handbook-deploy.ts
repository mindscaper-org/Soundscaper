/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { composeProductHeaders, retiredProductRedirects, webBuildProductId, webBuildRouting } from './product-web-routing.mjs';
import { handbookLocales } from './handbook-locales.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const execute = promisify(execFile);

/** Stage the checked handbook alone, retaining its product origin and HTTP policies. */
export async function prepareHandbookDeployment({
	repositoryRoot = ROOT, productId = webBuildProductId(),
}: { repositoryRoot?: string; productId?: string } = {}): Promise<string> {
	const routing = webBuildRouting({ SCAPE_PRODUCT: productId });
	const outputRoot = resolve(repositoryRoot, '.wrangler/handbook-site');
	await rm(outputRoot, { recursive: true, force: true });
	await execute(process.execPath, [resolve(ROOT, 'scripts/stage-handbook-build.mjs'),
		outputRoot, resolve(repositoryRoot, 'handbook/dist')], {
		env: { ...process.env, SCAPE_PRODUCT: productId },
	});
	const headers = composeProductHeaders(await readFile(resolve(repositoryRoot, 'public/_headers'), 'utf8'), routing);
	await writeFile(resolve(outputRoot, '_headers'), headers.replace('/*\n', '/*\n\tX-Scape-Handbook: independent\n'));
	const locales = handbookLocales(resolve(repositoryRoot, 'handbook/src/content/docs')).map(({ locale }) => locale);
	const redirects = retiredProductRedirects(routing, locales)
		.filter(({ source }: { source: string }) => source.startsWith(routing.handbook.scope))
		.map(({ source, destination, status }: { source: string; destination: string; status: number }) => `${source} ${destination} ${status}`);
	await writeFile(resolve(outputRoot, '_redirects'), [
		`${routing.handbook.basePath} ${routing.handbook.scope} 301`, ...redirects, '',
	].join('\n'));
	return outputRoot;
}

/** Prevent the first product deployment from removing docs before their Worker is live. */
export async function verifyIndependentHandbook({ origin, fetchImpl = fetch }: {
	origin: string; fetchImpl?: typeof fetch;
}): Promise<void> {
	const response = await fetchImpl(new URL('/docs/', origin), {
		cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000),
	});
	await response.body?.cancel();
	if (response.status !== 200 || response.headers.get('x-scape-handbook') !== 'independent') {
		throw new Error(`The independent handbook is not active on ${origin}/docs/. Run the Handbook workflow on main first.`);
	}
}
