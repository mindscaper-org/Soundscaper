// @ts-check
/* SPDX-License-Identifier: AGPL-3.0-only */
const productId = resolveDesktopProductId(process.env.SCAPE_PRODUCT);
const productName = 'Lightscaper';
// Development builds use ad-hoc seals; credentialed release jobs explicitly
// select a Developer ID identity and require notarization.
const signing = require('./scripts/lib/desktop-signing-config.cjs').desktopSigningConfig();
const macSigningIdentity = signing.mac.identity;
const macEntitlements = 'desktop/lightscaper-entitlements.mac.plist';
/** @type {import('electron-builder').Configuration} */
module.exports = {
	forceCodeSigning: signing.forceCodeSigning,
	appId: `org.${productId}.desktop`,
	productName,
	artifactName: '${productName}-${version}-${os}-${arch}.${ext}',
	compression: 'maximum',
	asar: true,
	// Stock Electron enables proprietary codecs in its Chromium FFmpeg library.
	// Replace it with Electron's matching alternate release asset before code sealing;
	// this framework library is not a Soundscaper codec-provider tier.
	downloadAlternateFFmpeg: true,
	npmRebuild: false,
	beforePack: './scripts/desktop-lightscaper-before-pack.mjs',
	afterPack: './scripts/desktop-lightscaper-after-pack.mjs',
	afterSign: './scripts/desktop-after-sign.mjs',
	afterAllArtifactBuild: './scripts/desktop-verify-release-artifacts.mjs',
	directories: {
		app: '.desktop-build/app',
		buildResources: '.desktop-build/icons',
		output: 'release/desktop',
	},
	files: [
		'desktop/**/*',
		'config/*.json',
		'package.json',
		'!node_modules/**/*',
		'!desktop/**/*.test.*',
	],
	extraResources: [
		{ from: '.desktop-build/renderer', to: 'renderer' },
		{ from: '.desktop-build/runtime', to: 'runtime' },
		{ from: '.desktop-build/licenses', to: 'licenses' },
	],
	win: {
		...signing.win,
		icon: 'icon.png',
		target: ['nsis', 'zip'],
	},
	nsis: {
		oneClick: false,
		perMachine: false,
		allowElevation: false,
		packElevateHelper: false,
		allowToChangeInstallationDirectory: true,
		createDesktopShortcut: true,
		createStartMenuShortcut: true,
		deleteAppDataOnUninstall: false,
	},
	mac: {
		notarize: signing.mac.notarize,
		icon: 'icon.png',
		identity: macSigningIdentity,
		// Ad-hoc signatures have no Team ID; hardened library validation would
		// reject the bundled Electron framework before the application can start.
		hardenedRuntime: signing.mac.notarize,
		entitlements: macEntitlements,
		entitlementsInherit: macEntitlements,
		gatekeeperAssess: false,
		category: 'public.app-category.photography',
		target: ['dmg'],
		extendInfo: {},
	},
	dmg: {
		sign: signing.mac.notarize,
		artifactName: '${productName}-${version}-mac-${arch}.${ext}',
	},
	linux: {
		icon: 'linux',
		executableName: productId,
		syncDesktopName: true,
		category: 'Graphics;Photography',
		synopsis: 'Local-first photo library and develop editor',
		description: 'Lightscaper is a local-first photo library and non-destructive develop editor with offline catalog backup and image export support.',
		maintainer: 'Mindscaper',
		target: ['AppImage', 'deb'],
	},
	appImage: {
		artifactName: '${productName}-${version}-linux-${arch}.${ext}',
	},
	deb: {
		artifactName: '${productName}-${version}-linux-${arch}.${ext}',
	},
	publish: null,
};

/**
 * @param {string | undefined} value
 * @returns {'lightscaper'}
 */
function resolveDesktopProductId(value) {
	const requested = value === undefined ? 'lightscaper' : value;
	if (requested !== 'lightscaper') {
		throw new Error(
			`Lightscaper configuration requires SCAPE_PRODUCT=lightscaper when supplied; received ${JSON.stringify(value)}.`,
		);
	}
	return requested;
}
