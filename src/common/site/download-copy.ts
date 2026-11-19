/* SPDX-License-Identifier: AGPL-3.0-only */

/** Source copy for the standalone download page and its scoped translation catalogs. */
export const DOWNLOAD_ENGLISH_COPY = Object.freeze({
	title: 'Download {name}',
	metaDescription: 'Download the latest {name} release candidate for Windows, macOS, and Linux.',
	soundscaperDescription: 'Record, edit, and mix audio on your desktop.',
	framescaperDescription: 'Edit video and audio on your desktop.',
	skip: 'Skip to downloads',
	mainNavigation: 'Main navigation',
	openBrowser: 'Open in browser',
	handbook: 'Handbook',
	language: 'Language',
	desktop: '{name} for desktop',
	unavailableTitle: 'Downloads are temporarily unavailable',
	emptyTitle: 'No release candidate is available yet',
	unavailableBody: 'We could not load the latest release candidate. Please try again, or browse the releases on GitHub.',
	emptyBody: 'Published desktop packages will appear here automatically. You can use the browser editor in the meantime.',
	browse: 'Browse {name} releases',
	retry: 'Try again',
	browserTitle: 'Prefer your browser?',
	browserBody: 'Open {name} without installing anything.',
	open: 'Open {name}',
	free: 'Free and open source',
	privacy: 'Privacy & Code signing policy',
	preview: 'This is a preview release for testing.',
	unknownPlatform: 'No matching desktop download was identified. Open Other downloads to choose a package, or use the browser editor.',
	unknownArchitecture: 'Your processor could not be identified. Check the architecture in the package name before downloading.',
	other: 'Other downloads',
	resources: 'Release resources',
	notes: 'Release notes',
	checksums: 'Checksums',
	source: 'Source code',
	notices: 'Third-party notices',
	license: 'AGPL license',
	windowsDetail: 'Install or run the portable version.',
	macDetail: 'For Macs with Apple silicon.',
	linuxDetail: 'AppImage, Debian, and Flatpak packages.',
	windowsInstaller: 'Windows {architecture} installer',
	windowsPortable: 'Windows {architecture} portable ZIP',
	macPkg: 'macOS Apple silicon PKG installer',
	macDmg: 'macOS Apple silicon DMG',
	linuxAppImage: 'Linux {architecture} AppImage',
	linuxDeb: 'Linux {architecture} Debian package',
	linuxFlatpak: 'Linux {architecture} Flatpak',
});

export type DownloadCopyKey = keyof typeof DOWNLOAD_ENGLISH_COPY;
export type DownloadCopy = Readonly<Record<DownloadCopyKey, string>>;

export function formatDownloadCopy(value: string, parameters: Readonly<Record<string, string>> = {}): string {
	return value.replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu, (placeholder: string, key: string) => parameters[key] ?? placeholder);
}
