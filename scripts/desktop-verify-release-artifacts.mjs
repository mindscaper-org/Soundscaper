/* SPDX-License-Identifier: AGPL-3.0-only */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { normalizeDesktopReleaseArtifacts } from './lib/desktop-release-artifact-names.mjs';

const execute = promisify(execFile);
export default async function verifyReleaseArtifacts(context, dependencies = {}) {
	const env = dependencies.env ?? process.env;
	const platform = dependencies.platform ?? process.platform;
	const executeFile = dependencies.executeFile ?? execute;
	if (platform === 'darwin' && env.SCAPE_MAC_SIGNING === 'true') {
		const packages = context.artifactPaths.filter(path => /\.(?:dmg|pkg)$/u.test(path));
		if (packages.length === 0) throw new Error('Signed Mac release produced no disk image or installer package.');
		for (const artifact of packages) {
			const installer = artifact.endsWith('.pkg');
			if (installer) {
				const result = await executeFile('pkgutil', ['--check-signature', artifact]);
				if (!env.CSC_INSTALLER_NAME?.startsWith('Developer ID Installer: ')
					|| !env.CSC_INSTALLER_NAME.endsWith(`(${env.APPLE_TEAM_ID})`)
					|| !result.stdout.includes('Status: signed by a developer certificate issued by Apple')
					|| !result.stdout.split(/\r?\n/u).some(line => (
						line.trim() === `1. ${env.CSC_INSTALLER_NAME}`
					))) throw new Error('The release PKG does not have the expected Developer ID Installer signature.');
			} else {
				await executeFile('codesign', ['--verify', '--strict', '--test-requirement',
					`anchor apple generic and certificate leaf[subject.OU] = "${env.APPLE_TEAM_ID}"`, artifact]);
			}
			try {
				const result = await executeFile('xcrun', ['notarytool', 'submit', artifact, '--wait', '--output-format', 'json',
					'--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD,
					'--team-id', env.APPLE_TEAM_ID], { timeout: 20 * 60_000 });
				const submission = JSON.parse(result.stdout);
				if (submission.status !== 'Accepted') {
					if (/^[a-f0-9-]{36}$/iu.test(submission.id ?? '')) {
						console.error(`Apple notarization submission ${submission.id} was not accepted.`);
					}
					throw new Error('Not accepted');
				}
			} catch {
				// Child-process errors contain argv, including the app-specific password.
				throw new Error('Apple did not accept the release package for notarization.');
			}
			await executeFile('xcrun', ['stapler', 'staple', artifact]);
			await executeFile('xcrun', ['stapler', 'validate', artifact]);
			if (installer) await executeFile('spctl', ['--assess', '--type', 'install', '--verbose=2', artifact]);
		}
	}
	if (platform === 'win32' && ['azure', 'certificate'].includes(env.SCAPE_WIN_SIGNING)) {
		const installers = context.artifactPaths.filter(path => path.endsWith('.exe'));
		if (installers.length === 0) throw new Error('Signed Windows release produced no installer.');
		for (const artifact of installers) {
			await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
				join(import.meta.dirname, 'verify-windows-release-signature.ps1'), '-Artifact', artifact]);
		}
	}
	const artifacts = await normalizeDesktopReleaseArtifacts(context.artifactPaths);
	context.artifactPaths.splice(0, context.artifactPaths.length, ...artifacts);
	return [];
}
