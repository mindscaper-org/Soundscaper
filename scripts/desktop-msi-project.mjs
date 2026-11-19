/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, writeFile } from 'node:fs/promises';
import { resolveProductDesktopMetadata } from './lib/product-release-lines.mjs';
import { prepareMsiProject } from './lib/desktop-msi-project.ts';

export default async function configureMsiProject(projectPath) {
	const productId = process.env.SCAPE_PRODUCT ?? 'soundscaper';
	const { applicationVersion } = resolveProductDesktopMetadata(productId);
	await writeFile(projectPath, prepareMsiProject(await readFile(projectPath, 'utf8'), productId, applicationVersion));
}
