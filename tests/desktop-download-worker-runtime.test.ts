/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = resolve(import.meta.dirname, '..');
const { compatibility_date: compatibilityDate } = JSON.parse(
	readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8'),
) as { compatibility_date: string };
const releases = ['Soundscaper', 'Framescaper'].map(name => ({
	tag_name: `${name.toLowerCase()}-v1.0.0-rc.1`, draft: false, published_at: '2026-10-31T00:00:00Z',
	assets: [{ name: `${name}-1.0.0-rc.1-win-x64.exe`, state: 'uploaded' }],
}));

for (const redirected of [false, true]) {
	test(`Cloudflare download handlers ${redirected ? 'reject upstream redirects without following them' : 'resolve releases using the actual runtime fetch'}`, async () => {
		const bundled = await build({
			stdin: {
				contents: `import { handleDownloadPageRequest } from './functions/download/index.ts';
import { handleDesktopDownloadRequest } from './functions/download/desktop/index.ts';
import { handleAudacityDownloadRequest } from './functions/download/audacity/index.ts';
export default { fetch(request) {
	if (new URL(request.url).pathname.startsWith('/download/audacity')) return handleAudacityDownloadRequest(request);
	return new URL(request.url).pathname.startsWith('/download/desktop')
		? handleDesktopDownloadRequest(request) : handleDownloadPageRequest(request);
} };`,
				resolveDir: root, sourcefile: 'download-worker-runtime.ts',
			},
			bundle: true, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', write: false,
		});
		assert.ok(!Object.keys(bundled.metafile.inputs).some(path => path.startsWith('src/common/i18n/translations/')),
			'The download Worker must not include the editor translation catalogs');
		const script = bundled.outputFiles[0]?.text;
		assert.ok(script);
		const runtime = new Miniflare({ workers: [
			{ config: { name: 'downloads', compatibilityDate,
				manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: script } } } },
			dev: { outboundService: { type: 'worker', worker: 'github' } } },
			{ config: { name: 'github', compatibilityDate,
				manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: `export default { fetch(request) {
	if (${String(redirected)} && new URL(request.url).hostname === 'api.github.com') {
		return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/releases' } });
	}
	if (new URL(request.url).hostname === 'raw.githubusercontent.com') return new Response("export const audacityReleases = { version: '4.9.1', win: [{ name: 'MSI', browser_download_url: 'https://github.com/audacity/audacity/releases/download/Audacity-4.9.1/audacity-win-4.9.1-arm64.msi' }] };\\n");
	return Response.json(${JSON.stringify(releases)});
} };` } } } } },
		] });
		try {
			const comparison = await runtime.dispatchFetch('https://soundscaper.org/download/audacity/fr/');
			assert.equal(comparison.status, 200);
			assert.equal(comparison.headers.get('content-language'), 'fr');
			const comparisonHtml = await comparison.text();
			assert.ok(comparisonHtml.includes('Téléchargez Audacity et Soundscaper'));
			assert.ok(comparisonHtml.includes('Pistes temporelles'));
			assert.ok(comparisonHtml.includes('audacity-win-4.9.1-arm64.msi'));
			assert.ok(!comparisonHtml.includes('kw.media'));
			for (const product of ['soundscaper', 'framescaper']) {
				const page = await runtime.dispatchFetch(`https://${product}.org/download/`);
				assert.equal(page.status, redirected ? 503 : 200);
				const html = await page.text();
				assert.ok(html.includes(redirected ? 'Downloads are temporarily unavailable' : '1.0.0-rc.1'));
				const localized = await runtime.dispatchFetch(`https://${product}.org/download/de/`);
				assert.equal(localized.status, redirected ? 503 : 200);
				assert.equal(localized.headers.get('content-language'), 'de');
				const localizedHtml = await localized.text();
				assert.ok(localizedHtml.includes(redirected ? 'Downloads sind vorübergehend nicht verfügbar' : 'Windows x64-Installationsprogramm'));
				const direct = await runtime.dispatchFetch(`https://${product}.org/download/desktop/`, {
					headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, redirect: 'manual',
				});
				assert.equal(direct.status, 302);
				assert.ok(direct.headers.get('location')?.includes(redirected ? `?q=${product}` : `${product}-v1.0.0-rc.1/`));
			}
		} finally {
			await runtime.dispose();
		}
	});
}
