/* SPDX-License-Identifier: AGPL-3.0-only */

import { desktopReleaseSearchUrl, type DesktopDownloadProductId } from '../editor/desktop-download-links.ts';
import type { DesktopDownloadEnvironment, DesktopDownloadTarget } from '../editor/desktop-download-target.ts';
import { handbookLanguagePath } from '../editor/documentation-links.ts';
import { DOWNLOAD_LOCALES } from './download-localization.ts';
import { DOWNLOAD_ENGLISH_COPY, formatDownloadCopy, type DownloadCopy, type DownloadCopyKey } from './download-copy.ts';
import type { DesktopReleaseCandidate } from './desktop-releases.ts';
import { privacyPolicyPath } from './privacy-policy-path.ts';
import { AUDACITY_DOWNLOAD_LANGUAGES } from './audacity-download/localization.ts';

const PACKAGE_KEYS: Readonly<Record<DesktopDownloadTarget, DownloadCopyKey>> = {
	'win-x64.exe': 'windowsInstaller', 'win-arm64.exe': 'windowsInstaller',
	'win-x64.zip': 'windowsPortable', 'win-arm64.zip': 'windowsPortable',
	'mac-arm64.pkg': 'macPkg', 'mac-arm64.dmg': 'macDmg',
	'linux-x64.AppImage': 'linuxAppImage', 'linux-arm64.AppImage': 'linuxAppImage',
	'linux-x64.deb': 'linuxDeb', 'linux-arm64.deb': 'linuxDeb',
	'linux-x64.flatpak': 'linuxFlatpak', 'linux-arm64.flatpak': 'linuxFlatpak',
};

const RESOURCE_KEYS: Readonly<Record<string, DownloadCopyKey>> = {
	SHA256SUMS: 'checksums', 'sources.zip': 'source',
	'THIRD_PARTY_LICENSES.md': 'notices', 'Soundscaper-AGPL-3.0.txt': 'license',
};

type Translate = (key: DownloadCopyKey, parameters?: Readonly<Record<string, string>>) => string;
interface DownloadLocalization { readonly locale: string; readonly direction: string; readonly copy: DownloadCopy }

export function renderDownloadPage(
	productId: DesktopDownloadProductId,
	release: DesktopReleaseCandidate | null,
	unavailable = false,
	environment: DesktopDownloadEnvironment = { platform: null, architecture: null },
	{ locale, direction, copy }: DownloadLocalization = { locale: 'en', direction: 'ltr', copy: DOWNLOAD_ENGLISH_COPY },
): string {
	const name = productId === 'soundscaper' ? 'Soundscaper' : 'Framescaper';
	const peer = productId === 'soundscaper' ? 'Framescaper' : 'Soundscaper';
	const canonical = `https://${productId}.org/download/${locale}/`;
	const t: Translate = (key, parameters) => escapeHtml(formatDownloadCopy(copy[key], parameters));
	const editor = `/${locale}/`;
	const comparisonLink = productId === 'soundscaper' ? `<a href="/download/audacity/${AUDACITY_DOWNLOAD_LANGUAGES.includes(locale) ? locale : 'en'}/">${t('title', { name: 'Audacity' })}</a>` : '';
	return `<!doctype html>
<html lang="${escapeHtml(locale)}" dir="${escapeHtml(direction)}">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${t('title', { name })}</title>
	<meta name="description" content="${t('metaDescription', { name })}">
	<link rel="canonical" href="${canonical}">
	${DOWNLOAD_LOCALES.map(descriptor => `<link rel="alternate" hreflang="${descriptor.locale}" href="https://${productId}.org/download/${descriptor.locale}/">`).join('\n\t')}
	<link rel="alternate" hreflang="x-default" href="https://${productId}.org/download/en/">
	<link rel="icon" type="image/svg+xml" href="/logo/${productId}.svg">
	<link rel="stylesheet" href="/download.css">
</head>
<body>
	<a class="skip-link" href="#main">${t('skip')}</a>
	<header class="site-header">
		<a class="brand" href="${editor}"><img src="/logo/${productId}.svg" width="36" height="36" alt="">${name}</a>
		<nav aria-label="${t('mainNavigation')}"><a href="${editor}">${t('openBrowser')}</a><a href="/docs${handbookLanguagePath(locale)}/">${t('handbook')}</a>
			<details class="language-menu"><summary>${t('language')}</summary><ul>${DOWNLOAD_LOCALES.map(descriptor =>
		`<li><a href="/download/${descriptor.locale}/" lang="${descriptor.locale}" dir="${descriptor.direction}" hreflang="${descriptor.locale}"${descriptor.locale === locale ? ' aria-current="page"' : ''}>${escapeHtml(descriptor.nativeName)}</a></li>`).join('')}</ul></details>
		</nav>
	</header>
	<main id="main">
		<div class="intro"><p class="eyebrow">${release === null ? t('desktop', { name }) : releaseEyebrow(release, locale)}</p>
		<h1>${t('title', { name })}</h1><p class="lead">${t(productId === 'soundscaper' ? 'soundscaperDescription' : 'framescaperDescription')}</p></div>
		${release === null ? `<section class="release-status" aria-labelledby="release-title">
			<h2 id="release-title">${t(unavailable ? 'unavailableTitle' : 'emptyTitle')}</h2>
			<p>${t(unavailable ? 'unavailableBody' : 'emptyBody')}</p>
			<a href="${escapeHtml(desktopReleaseSearchUrl(productId))}">${t('browse', { name })}</a>
			${unavailable ? `<a href="${canonical}">${t('retry')}</a>` : ''}
			${comparisonLink ? `<details class="other-downloads"><summary>${t('other')}</summary>${comparisonLink}</details>` : ''}
		</section>` : renderRelease(release, environment, t, comparisonLink)}
		<section class="browser-option" aria-labelledby="browser-title">
			<div><h2 id="browser-title">${t('browserTitle')}</h2><p>${t('browserBody', { name })}</p></div>
			<a class="button secondary" href="${editor}">${t('open', { name })}</a>
		</section>
	</main>
	<footer><span>${name} · ${t('free')}</span><a href="https://${peer.toLowerCase()}.org/download/${locale}/">${t('title', { name: peer })}</a><a href="${privacyPolicyPath(locale)}">${t('privacy')}</a></footer>
</body>
</html>`;
}

function releaseEyebrow(release: DesktopReleaseCandidate, locale: string): string {
	const published = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })
		.format(new Date(release.publishedAt));
	return `<bdi>${escapeHtml(release.version)}</bdi> · <time datetime="${escapeHtml(release.publishedAt)}">${escapeHtml(published)}</time>`;
}

type Installer = DesktopReleaseCandidate['installers'][number];

function renderRelease(release: DesktopReleaseCandidate, environment: DesktopDownloadEnvironment, t: Translate, comparisonLink: string): string {
	const matches = (installer: Installer): boolean => environment.platform !== null
		&& installer.target.startsWith(`${environment.platform}-`)
		&& (environment.architecture === null || installer.target.startsWith(`${environment.platform}-${environment.architecture}.`));
	const matching = release.installers.filter(matches);
	const others = release.installers.filter(installer => !matches(installer));
	const detectionNote = matching.length === 0
		? `<p class="detection-note">${t('unknownPlatform')}</p>`
		: environment.architecture === null
			? `<p class="detection-note">${t('unknownArchitecture')}</p>` : '';
	return `<p class="candidate-note">${t('preview')}</p>
	${detectionNote}
	${matching.length ? `<div class="platforms matching-downloads">${renderPlatforms(matching, 'matching', t)}</div>` : ''}
	${others.length || comparisonLink ? `<details class="other-downloads"><summary>${t('other')}</summary>
		<div class="platforms">${renderPlatforms(others, 'other', t)}</div>${comparisonLink}</details>` : ''}
	<nav class="release-resources" aria-label="${t('resources')}"><a href="${escapeHtml(release.url)}">${t('notes')}</a>${release.resources.map(resource =>
		`<a href="${escapeHtml(resource.url)}">${RESOURCE_KEYS[resource.name] ? t(RESOURCE_KEYS[resource.name]) : escapeHtml(resource.name)}</a>`).join('')}</nav>`;
}

function renderPlatforms(installers: readonly Installer[], group: string, t: Translate): string {
	return ([
		{ name: 'Windows', id: 'win', detail: 'windowsDetail' },
		{ name: 'macOS', id: 'mac', detail: 'macDetail' },
		{ name: 'Linux', id: 'linux', detail: 'linuxDetail' },
	] as const).map(platform => {
		const packages = installers.filter(installer => installer.target.startsWith(`${platform.id}-`));
		if (packages.length === 0) return '';
		const headingId = `${group}-${platform.id}-title`;
		return `<section class="platform" aria-labelledby="${headingId}">
			<h2 id="${headingId}">${platform.name}</h2><p>${t(platform.detail)}</p>
			<ul>${packages.map(installer => `<li><a class="package" href="${escapeHtml(installer.url)}">${t(PACKAGE_KEYS[installer.target], { architecture: installer.target.includes('-arm64.') ? 'ARM64' : 'x64' })} <span aria-hidden="true">↓</span></a></li>`).join('')}</ul>
		</section>`;
	}).join('');
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}
