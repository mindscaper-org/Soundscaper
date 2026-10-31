/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const FFMPEG_LABEL = 'Add FFmpeg-support for proprietary file formats (M4A, MP4, MOV and more)';
const PRODUCTS = Object.freeze({ soundscaper: 'Soundscaper', framescaper: 'Framescaper' });

function productName(productId) {
	if (!Object.hasOwn(PRODUCTS, productId)) throw new TypeError('Unknown desktop installer product.');
	return PRODUCTS[productId];
}

function xml(value) {
	return String(value).replace(/[&<>"']/gu, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
	})[character]);
}

/** Native Installer choices are independent packages: an unselected package runs no scripts. */
export function macInstallerDistribution({ productId, version, minimumSystemVersion }) {
	const name = productName(productId);
	const identifier = `org.${productId}.desktop`;
	return `<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
	<title>${name}</title>
	<options customize="always" hostArchitectures="arm64" rootVolumeOnly="true" require-scripts="false"/>
	<volume-check><allowed-os-versions><os-version min="${xml(minimumSystemVersion)}"/></allowed-os-versions></volume-check>
	<choices-outline><line choice="application"/><line choice="ffmpeg"/></choices-outline>
	<choice id="application" title="${name}" description="Install ${name} in Applications." enabled="false" selected="true"><pkg-ref id="${identifier}"/></choice>
	<choice id="ffmpeg" title="${FFMPEG_LABEL}" start_selected="false" description="Downloads and installs FFmpeg through Homebrew for the logged-in user. Homebrew will also be installed if it is missing, including Apple Command Line Tools when required. An internet connection and additional disk space are required."><pkg-ref id="${identifier}.ffmpeg"/></choice>
	<pkg-ref id="${identifier}" version="${xml(version)}" auth="Root">${identifier}.pkg</pkg-ref>
	<pkg-ref id="${identifier}.ffmpeg" version="${xml(version)}" auth="Root">${identifier}.ffmpeg.pkg</pkg-ref>
</installer-gui-script>
`;
}

/** Assemble the already sealed app and an optional, separately selected FFmpeg script package. */
export async function buildMacInstaller(options, dependencies = {}) {
	const { appPath, outDir, productId, version, installerIdentity = null, keychain } = options;
	const name = productName(productId);
	if (!isAbsolute(appPath) || !isAbsolute(outDir) || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?$/u.test(version)) {
		throw new TypeError('Mac installer requires absolute paths and a valid product version.');
	}
	const appMetadata = await lstat(appPath);
	if (!appMetadata.isDirectory() || appMetadata.isSymbolicLink()) throw new Error('Mac installer requires the packaged app directory.');
	const executeFile = dependencies.executeFile ?? execute;
	const identifier = `org.${productId}.desktop`;
	const artifact = join(outDir, `${name}-${version}-mac-arm64.pkg`);
	const workingDirectory = await mkdtemp(join(outDir, '.mac-pkg-'));
	try {
		const minimum = (await executeFile('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion',
			join(appPath, 'Contents', 'Info.plist')])).stdout.trim();
		if (!/^\d+(?:\.\d+){0,2}$/u.test(minimum)) throw new Error('Packaged app has no valid minimum macOS version.');
		const payload = join(workingDirectory, 'payload');
		const scripts = join(workingDirectory, 'ffmpeg-scripts');
		await mkdir(payload);
		await mkdir(scripts);
		await executeFile('ditto', ['--rsrc', '--extattr', appPath, join(payload, `${name}.app`)]);
		const componentPlist = join(workingDirectory, 'components.plist');
		await writeFile(componentPlist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array><dict>
<key>RootRelativeBundlePath</key><string>${name}.app</string>
<key>BundleIsRelocatable</key><false/>
<key>BundleIsVersionChecked</key><false/>
<key>BundleOverwriteAction</key><string>upgrade</string>
</dict></array></plist>
`);
		const postinstall = (await readFile(new URL('../desktop/installer/macos-ffmpeg-postinstall.sh', import.meta.url), 'utf8'))
			.replaceAll('@PRODUCT_NAME@', name);
		await writeFile(join(scripts, 'postinstall'), postinstall);
		await chmod(join(scripts, 'postinstall'), 0o755);
		// Installer receipts use the numeric version; the release filename retains its RC suffix.
		const packageVersion = /^\d+\.\d+\.\d+/u.exec(version)[0];
		// Keep gzip/cpio payloads readable by the Linux release-audit extractor.
		await executeFile('pkgbuild', ['--root', payload, '--compression', 'legacy', '--component-plist', componentPlist,
			'--identifier', identifier, '--version', packageVersion, '--install-location', '/Applications',
			join(workingDirectory, `${identifier}.pkg`)]);
		const ffmpegBase = join(workingDirectory, 'ffmpeg-base.pkg');
		await executeFile('pkgbuild', ['--nopayload', '--identifier', `${identifier}.ffmpeg`,
			'--version', packageVersion, '--scripts', scripts, ffmpegBase]);
		// Apple's default package-script timeout is ten minutes, shorter than a fresh
		// Command Line Tools download. Amend this unsigned component before sealing it.
		const expandedFfmpeg = join(workingDirectory, 'ffmpeg-expanded');
		await executeFile('pkgutil', ['--expand', ffmpegBase, expandedFfmpeg]);
		const packageInfoPath = join(expandedFfmpeg, 'PackageInfo');
		const packageInfo = await readFile(packageInfoPath, 'utf8');
		const scriptsToExtend = packageInfo.match(/<postinstall\b[^>]*>/gu);
		if (scriptsToExtend?.length !== 1) throw new Error('FFmpeg component must contain exactly one postinstall script.');
		await writeFile(packageInfoPath, packageInfo.replace(scriptsToExtend[0], scriptsToExtend[0]
			.replace(/\s+timeout="[^"]*"/u, '').replace(/\/?>$/u, (ending) => ` timeout="7200"${ending}`)));
		await executeFile('pkgutil', ['--flatten', expandedFfmpeg, join(workingDirectory, `${identifier}.ffmpeg.pkg`)]);
		const distribution = join(workingDirectory, 'Distribution.xml');
		await writeFile(distribution, macInstallerDistribution({ productId, version: packageVersion, minimumSystemVersion: minimum }));
		const temporaryArtifact = join(workingDirectory, `${name}.pkg`);
		const sign = installerIdentity === null ? [] : ['--sign', installerIdentity, ...(keychain ? ['--keychain', keychain] : [])];
		await executeFile('productbuild', [...sign, '--distribution', distribution, '--package-path', workingDirectory, temporaryArtifact]);
		const artifactMetadata = await lstat(temporaryArtifact);
		if (!artifactMetadata.isFile() || artifactMetadata.isSymbolicLink() || artifactMetadata.size === 0) {
			throw new Error('productbuild did not produce a regular installer package.');
		}
		await link(temporaryArtifact, artifact);
		return artifact;
	} finally {
		await rm(workingDirectory, { recursive: true, force: true });
	}
}
