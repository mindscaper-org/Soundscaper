/* SPDX-License-Identifier: AGPL-3.0-only */

/** @param {NodeJS.ProcessEnv} [environment] */
function desktopAppxSettings(environment = process.env) {
	const required = (name) => {
		const value = environment[name]?.trim();
		if (!value) throw new Error(`AppX packaging requires ${name}.`);
		return value;
	};
	const identityName = required('SCAPE_APPX_IDENTITY_NAME');
	if (!/^[A-Za-z0-9.-]{3,50}$/u.test(identityName)) throw new Error('Invalid SCAPE_APPX_IDENTITY_NAME.');
	const publisher = required('SCAPE_APPX_PUBLISHER');
	if (!/^CN=\S[^\r\n]*$/u.test(publisher)) throw new Error('Invalid SCAPE_APPX_PUBLISHER; copy Publisher from Partner Center.');
	const publisherDisplayName = required('SCAPE_APPX_PUBLISHER_DISPLAY_NAME');
	const version = required('SCAPE_APPX_VERSION');
	const parts = version.split('.');
	if (parts.length !== 4 || parts.some(part => !/^(?:0|[1-9]\d*)$/u.test(part) || Number(part) > 65535)
		|| Number(parts[0]) === 0 || parts[3] !== '0') {
		throw new Error('SCAPE_APPX_VERSION must be four integers (1..65535.0..65535.0..65535.0), with no leading zeros.');
	}
	return { identityName, publisher, publisherDisplayName, version };
}

/** @param {import('electron-builder').Configuration} base @param {NodeJS.ProcessEnv} [environment] */
function createDesktopAppxConfig(base, environment = process.env) {
	const settings = desktopAppxSettings(environment);
	return {
		...base,
		forceCodeSigning: false,
		artifactName: '${productName}-${version}-store-${arch}.${ext}',
		directories: { ...base.directories, output: 'release/appx' },
		// Preserve the authenticated native payloads byte for byte. The Store
		// signs the enclosing AppX; local sideload testing signs that package only.
		win: { ...base.win, azureSignOptions: undefined, signtoolOptions: undefined,
			target: ['appx'], signExecutable: false },
		afterSign: null,
		afterAllArtifactBuild: './scripts/desktop-appx-after-artifact.mjs',
		appx: {
			identityName: settings.identityName,
			publisher: settings.publisher,
			publisherDisplayName: settings.publisherDisplayName,
			applicationId: base.productName,
			displayName: base.productName,
			customManifestPath: 'appxmanifest.xml',
			setBuildNumber: false,
			addAutoLaunchExtension: false,
			capabilities: ['runFullTrust'],
			minVersion: '10.0.19041.0',
		},
	};
}

module.exports = { desktopAppxSettings, createDesktopAppxConfig };
