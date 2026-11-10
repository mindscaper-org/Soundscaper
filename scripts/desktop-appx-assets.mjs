/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

import { desktopAppxSettings } from './lib/desktop-appx-config.cjs';

/** Generate branded assets without host fonts; retain the pinned builder's manifest schema. */
export async function prepareDesktopAppxAssets({ repositoryRoot, outputRoot, productId, version }) {
	if (!['soundscaper', 'framescaper'].includes(productId)) throw new Error('Invalid AppX product.');
	desktopAppxSettings({ SCAPE_APPX_IDENTITY_NAME: 'Validation.Only', SCAPE_APPX_PUBLISHER: 'CN=Validation',
		SCAPE_APPX_PUBLISHER_DISPLAY_NAME: 'Validation', SCAPE_APPX_VERSION: version });
	const source = (await readFile(join(repositoryRoot, 'public/logo', `${productId}.svg`), 'utf8'))
		.replace(/<text\b[\s\S]*?<\/text>/gu, '');
	const viewBox = source.match(/\bviewBox="([^"]+)"/u)?.[1];
	const rootTag = source.match(/<svg\b[^>]*>/u)?.[0];
	if (!viewBox || !rootTag) throw new Error('AppX artwork requires an SVG viewBox.');
	await mkdir(join(outputRoot, 'appx'), { recursive: true });
	for (const { name, width, height } of [
		{ name: 'StoreLogo.png', width: 50, height: 50 },
		{ name: 'Square44x44Logo.png', width: 44, height: 44 },
		{ name: 'Square150x150Logo.png', width: 150, height: 150 },
		{ name: 'Wide310x150Logo.png', width: 310, height: 150 },
	]) {
		const artwork = source.replace(rootTag, rootTag
			.replace(/\bwidth="[^"]*"/u, `width="${width * 0.8}"`)
			.replace(/\bheight="[^"]*"/u, `height="${height * 0.8}"`)
			.replace(/>$/u, ` x="${width * 0.1}" y="${height * 0.1}" preserveAspectRatio="xMidYMid meet">`));
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${artwork}</svg>`;
		const png = new Resvg(svg, { font: { loadSystemFonts: false } }).render().asPng();
		await writeFile(join(outputRoot, 'appx', name), png);
	}
	const require = createRequire(import.meta.url);
	const builderRoot = dirname(require.resolve('app-builder-lib/package.json'));
	const template = await readFile(join(builderRoot, 'templates/appx/appxmanifest.xml'), 'utf8');
	if (!template.includes('Version="${version}"')) throw new Error('The pinned AppX manifest template changed.');
	await writeFile(join(outputRoot, 'appxmanifest.xml'), template.replace('Version="${version}"', `Version="${version}"`));
}
