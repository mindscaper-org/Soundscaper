/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { resolveProductDesktopMetadata } from './lib/product-release-lines.mjs';
import { prepareMsiProject, stageLongMsiSources } from './lib/desktop-msi-project.ts';

export default async function configureMsiProject(projectPath) {
	const productId = process.env.SCAPE_PRODUCT ?? 'soundscaper';
	const { applicationVersion } = resolveProductDesktopMetadata(productId);
	let source = prepareMsiProject(await readFile(projectPath, 'utf8'), productId, applicationVersion);
	if (process.platform === 'win32') {
		const stage = dirname(projectPath);
		const arch = /^__msi-(x64|arm64|ia32)$/u.exec(basename(stage))?.[1];
		if (arch === undefined) throw new Error('Unexpected electron-builder WiX staging directory.');
		const unpacked = arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`;
		source = await stageLongMsiSources(source, projectPath, join(dirname(stage), unpacked));
	}
	await writeFile(projectPath, source);
}
