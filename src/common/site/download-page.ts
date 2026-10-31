/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopReleaseSearchUrl, type DesktopDownloadProductId } from '../editor/desktop-download-links.ts';
import type { DesktopDownloadTarget } from '../editor/desktop-download-target.ts';
import type { DesktopReleaseCandidate } from './desktop-releases.ts';

const PACKAGE_LABELS: Readonly<Record<DesktopDownloadTarget, string>> = {
	'win-x64.exe': 'Windows x64 installer', 'win-arm64.exe': 'Windows ARM64 installer',
	'win-x64.zip': 'Windows x64 portable ZIP', 'win-arm64.zip': 'Windows ARM64 portable ZIP',
	'mac-arm64.dmg': 'macOS Apple silicon DMG',
	'linux-x64.AppImage': 'Linux x64 AppImage', 'linux-arm64.AppImage': 'Linux ARM64 AppImage',
	'linux-x64.deb': 'Linux x64 Debian package', 'linux-arm64.deb': 'Linux ARM64 Debian package',
	'linux-x64.flatpak': 'Linux x64 Flatpak', 'linux-arm64.flatpak': 'Linux ARM64 Flatpak',
};

const RESOURCE_LABELS: Readonly<Record<string, string>> = {
	SHA256SUMS: 'Checksums', 'sources.zip': 'Source code',
	'THIRD_PARTY_LICENSES.md': 'Third-party notices', 'Soundscaper-AGPL-3.0.txt': 'AGPL license',
};

export function renderDownloadPage(
	productId: DesktopDownloadProductId,
	release: DesktopReleaseCandidate | null,
	unavailable = false,
): string {
	const name = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	const peer = productId === 'soundscaper' ? 'Framescaper' : 'Soundscaper';
	const canonical = `https://${productId}.org/download/`;
	const description = productId === 'soundscaper' ? 'Record, edit, and mix audio on your desktop.' : 'Edit video and audio on your desktop.';
	return `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Download ${name}</title>
	<meta name="description" content="Download the latest ${name} release candidate for Windows, macOS, and Linux.">
	<link rel="canonical" href="${canonical}">
	<link rel="icon" type="image/svg+xml" href="/logo/${productId}.svg">
	<link rel="stylesheet" href="/download.css">
</head>
<body>
	<a class="skip-link" href="#main">Skip to downloads</a>
	<header class="site-header">
		<a class="brand" href="/en/"><img src="/logo/${productId}.svg" width="36" height="36" alt="">${name}</a>
		<nav aria-label="Main navigation"><a href="/en/">Open in browser</a><a href="/docs/">Handbook</a></nav>
	</header>
	<main id="main">
		<div class="intro"><p class="eyebrow">${name} for desktop</p>
		<h1>Download ${name}</h1><p class="lead">${description}</p></div>
		${release === null ? `<section class="release-status" aria-labelledby="release-title">
			<h2 id="release-title">${unavailable ? 'Downloads are temporarily unavailable' : 'No release candidate is available yet'}</h2>
			<p>${unavailable ? 'We could not load the latest release candidate. Please try again, or browse the releases on GitHub.' : 'Published desktop packages will appear here automatically. You can use the browser editor in the meantime.'}</p>
			<a href="${escapeHtml(desktopReleaseSearchUrl(productId))}">Browse ${name} releases</a>
			${unavailable ? `<a href="${canonical}">Try again</a>` : ''}
		</section>` : renderRelease(release)}
		<section class="browser-option" aria-labelledby="browser-title">
			<div><h2 id="browser-title">Prefer your browser?</h2><p>Open ${name} without installing anything.</p></div>
			<a class="button secondary" href="/en/">Open ${name}</a>
		</section>
	</main>
	<footer><span>${name} · Free and open source</span><a href="https://${peer.toLowerCase()}.org/download/">Download ${peer}</a><a href="/privacy/en/">Privacy &amp; legal</a></footer>
</body>
</html>`;
}

function renderRelease(release: DesktopReleaseCandidate): string {
	const published = new Intl.DateTimeFormat('en', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
		.format(new Date(release.publishedAt));
	return `<section class="release-summary" aria-labelledby="release-title">
		<div><p class="eyebrow">Latest release candidate</p><h2 id="release-title">${escapeHtml(release.version)}</h2>
		<p>Published <time datetime="${escapeHtml(release.publishedAt)}">${escapeHtml(published)}</time></p></div>
		<a href="${escapeHtml(release.url)}">Release notes &amp; all files <span aria-hidden="true">↗</span></a>
	</section>
	<p class="candidate-note">This is a preview release for testing. Choose the package for your operating system and processor.</p>
	<div class="platforms">${[
		{ name: 'Windows', prefix: 'win-', detail: 'Install or run the portable version.' },
		{ name: 'macOS', prefix: 'mac-', detail: 'For Macs with Apple silicon.' },
		{ name: 'Linux', prefix: 'linux-', detail: 'AppImage, Debian, and Flatpak packages.' },
	].map(platform => {
		const installers = release.installers.filter(installer => installer.target.startsWith(platform.prefix));
		return `<section class="platform" aria-labelledby="${platform.prefix}title">
			<h2 id="${platform.prefix}title">${platform.name}</h2><p>${platform.detail}</p>
			${installers.length ? `<ul>${installers.map(installer => `<li><a class="package" href="${escapeHtml(installer.url)}">${PACKAGE_LABELS[installer.target]} <span aria-hidden="true">↓</span></a></li>`).join('')}</ul>`
				: '<p class="missing">No package has been published for this release candidate.</p>'}
		</section>`;
	}).join('')}</div>
	${release.resources.length ? `<nav class="release-resources" aria-label="Release resources">${release.resources.map(resource =>
		`<a href="${escapeHtml(resource.url)}">${escapeHtml(RESOURCE_LABELS[resource.name] ?? resource.name)}</a>`).join('')}</nav>` : ''}`;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
