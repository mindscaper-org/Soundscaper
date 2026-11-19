/* SPDX-License-Identifier: AGPL-3.0-only */

export const NIGHTLY_BROWSER_SOURCE_INPUTS = Object.freeze([
	{ source: 'src', destination: 'src', kind: 'directory', label: 'browser-test source tree' },
	...['functions/download/index.ts', 'functions/download/audacity/index.ts'].map(source => ({
		source, destination: source, kind: 'file', label: 'download-page browser fixture handler',
	})),
	...['download.css', 'audacity-download.css'].map(file => ({
		source: `public/${file}`, destination: `public/${file}`, kind: 'file', label: 'download-page browser fixture stylesheet',
	})),
	{ source: 'vendor/audacity-design-system/tokens', destination: 'vendor/audacity-design-system/tokens', kind: 'directory', label: 'design-system tokens used by browser assertions' },
	{ source: 'vendor/audacity-design-system/components/src/utils/roseus-colormap.ts', destination: 'vendor/audacity-design-system/components/src/utils/roseus-colormap.ts', kind: 'file', label: 'spectrogram painter browser harness colormap' },
]);
