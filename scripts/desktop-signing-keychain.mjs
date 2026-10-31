#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executeNative = promisify(execFile);
const execute = async (file, args) => executeNative(file, args);
export async function setupDesktopSigningKeychain({ env = process.env, executeFile = execute } = {}) {
	if (!env.RUNNER_TEMP || !env.GITHUB_ENV) throw new Error('RUNNER_TEMP and GITHUB_ENV are required.');
	if (!env.MAC_CERTIFICATE_P12 || !env.MAC_CERTIFICATE_PASSWORD) throw new Error('Mac application certificate secrets are incomplete.');
	if (!env.MAC_INSTALLER_CERTIFICATE_P12 || !env.MAC_INSTALLER_CERTIFICATE_PASSWORD) {
		throw new Error('Mac installer certificate secrets are incomplete.');
	}
	const directory = join(resolve(env.RUNNER_TEMP), 'soundscaper-signing');
	const keychain = join(directory, 'release.keychain-db');
	await mkdir(directory, { mode: 0o700 });
	const certificates = [
		{ path: join(directory, 'application.p12'), encoded: env.MAC_CERTIFICATE_P12, password: env.MAC_CERTIFICATE_PASSWORD,
			tools: ['/usr/bin/codesign', '/usr/bin/security'] },
		{ path: join(directory, 'installer.p12'), encoded: env.MAC_INSTALLER_CERTIFICATE_P12, password: env.MAC_INSTALLER_CERTIFICATE_PASSWORD,
			tools: ['/usr/bin/productbuild', '/usr/bin/productsign', '/usr/bin/security'] },
	];
	const temporaryPassword = randomBytes(32).toString('hex');
	try {
		await executeFile('security', ['create-keychain', '-p', temporaryPassword, keychain]);
		await executeFile('security', ['set-keychain-settings', '-lut', '21600', keychain]);
		await executeFile('security', ['unlock-keychain', '-p', temporaryPassword, keychain]);
		for (const certificate of certificates) {
			await writeFile(certificate.path, Buffer.from(certificate.encoded, 'base64'), { mode: 0o600, flag: 'wx' });
			await executeFile('security', ['import', certificate.path, '-k', keychain, '-P', certificate.password,
				...certificate.tools.flatMap((tool) => ['-T', tool])]);
		}
		await executeFile('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', temporaryPassword, keychain]);
		await appendFile(env.GITHUB_ENV, `CSC_KEYCHAIN=${keychain}\n`);
	} catch {
		// execFile errors include argv; never print private-key passwords.
		await executeFile('security', ['delete-keychain', keychain]).catch(() => {});
		throw new Error('Unable to import the Developer ID certificates into the temporary signing keychain.');
	} finally {
		await Promise.all(certificates.map(({ path }) => rm(path, { force: true })));
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.platform !== 'darwin') throw new Error('Signing keychains require a macOS runner.');
	if (!process.env.RUNNER_TEMP) throw new Error('RUNNER_TEMP is required.');
	if (process.argv[2] === 'setup') await setupDesktopSigningKeychain();
	else if (process.argv[2] === 'cleanup') {
		const directory = join(resolve(process.env.RUNNER_TEMP), 'soundscaper-signing');
		await execute('security', ['delete-keychain', join(directory, 'release.keychain-db')]).catch(() => {});
		await rm(directory, { recursive: true, force: true });
	} else throw new Error('Expected setup or cleanup.');
}
