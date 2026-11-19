/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }

export async function packagedAppFixture(root: string, sourceRevision: string): Promise<void> {
	const resources = join(root, 'linux-unpacked/resources');
	await mkdir(resources, { recursive: true });
	await writeFile(join(root, 'linux-unpacked/soundscaper'), 'executable');
	const resource = Buffer.from('resource');
	await writeFile(join(resources, 'app.asar'), resource);
	const files = [{ path: 'app.asar', byteLength: resource.byteLength, sha256: sha256(resource) }];
	await writeFile(join(resources, 'milestone-5-package-content.json'), `${JSON.stringify({
		schemaVersion: 1, status: 'installed-resource-closure-audited',
		productId: 'soundscaper', targetId: 'linux-x64', applicationVersion: '1.0.0-rc.1',
		sourceRevision,
		runtimeManifest: {
			byteLength: 1, sha256: '1'.repeat(64),
			value: { schemaVersion: 1, productId: 'soundscaper', sourceRevision,
				target: { platform: 'linux', arch: 'x64' } },
		},
		files, fileCount: 1, totalBytes: resource.byteLength,
		closureSha256: sha256(Buffer.from(JSON.stringify(files), 'utf8')),
	}, null, 2)}\n`);
}
