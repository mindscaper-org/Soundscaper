/* SPDX-License-Identifier: AGPL-3.0-only */

import { basename, join } from 'node:path';
import signing from './lib/desktop-signing-config.cjs';
import { buildMacInstaller } from './desktop-mac-pkg.mjs';
import verifyReleaseArtifacts from './desktop-verify-release-artifacts.mjs';

/** The custom PKG Distribution exposes choices unavailable in electron-builder's synthesized target. */
export default async function afterAllArtifactBuild(context, dependencies = {}) {
	const platform = dependencies.platform ?? process.platform;
	const env = dependencies.env ?? process.env;
	const buildInstaller = dependencies.buildInstaller ?? buildMacInstaller;
	const verifyArtifacts = dependencies.verifyArtifacts ?? verifyReleaseArtifacts;
	const additionalArtifacts = [];
	if (platform === 'darwin') {
		for (const artifact of [...context.artifactPaths]) {
			const match = /^(Soundscaper|Framescaper)-(.+)-mac-arm64\.dmg$/u.exec(basename(artifact));
			if (!match) continue;
			const installer = await buildInstaller({
				appPath: join(context.outDir, 'mac-arm64', `${match[1]}.app`), outDir: context.outDir,
				productId: match[1].toLowerCase(), version: match[2],
				installerIdentity: signing.desktopInstallerSigningIdentity(env, platform), keychain: env.CSC_KEYCHAIN,
			});
			context.artifactPaths.push(installer);
			additionalArtifacts.push(installer);
		}
	}
	const verifiedAdditional = await verifyArtifacts(context, dependencies);
	return [...additionalArtifacts, ...verifiedAdditional];
}
