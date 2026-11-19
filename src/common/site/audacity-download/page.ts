/* SPDX-License-Identifier: AGPL-3.0-only */

import { handbookLanguagePath } from '../../editor/documentation-links.ts';
import { downloadCopyForLocale } from '../download-localization.ts';
import { privacyPolicyPath } from '../privacy-policy-path.ts';
import { escapeHtml as escape, renderComparison } from './comparison.ts';
import { AUDACITY_DOWNLOAD_LOCALES, audacityDownloadCatalog } from './localization.ts';
import { assetLabel, matchingDownload, type DownloadReleases } from './releases.ts';

export async function renderAudacityDownloadPage(locale: string, releases: DownloadReleases, headers: Headers): Promise<string> {
	const catalog = await audacityDownloadCatalog(locale);
	const copy = catalog.copy;
	const shell = await downloadCopyForLocale(locale);
	const editor = `/${locale}/`;
	const comparisonUrl = `/docs${handbookLanguagePath(locale)}/start/how-soundscaper-compares/`;
	const path = (language: string): string => `/download/audacity/${language}/`;
	return `<!doctype html>
<html lang="${locale}" dir="${catalog.direction}">
<head>
	<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
	<title>${escape(copy.heading)}</title><meta name="description" content="${escape(catalog.description)}">
	<link rel="canonical" href="https://soundscaper.org${path(locale)}">
	${AUDACITY_DOWNLOAD_LOCALES.map(language => `<link rel="alternate" hreflang="${language.locale}" href="https://soundscaper.org${path(language.locale)}">`).join('\n\t')}
	<link rel="alternate" hreflang="x-default" href="https://soundscaper.org${path('en')}">
	<link rel="icon" type="image/svg+xml" href="/logo/soundscaper.svg">
	<link rel="stylesheet" href="/download.css"><link rel="stylesheet" href="/audacity-download.css">
</head>
<body>
	<a class="skip-link" href="#main">${escape(shell.skip)}</a>
	<header class="site-header"><a class="brand" href="${editor}"><img src="/logo/soundscaper.svg" width="36" height="36" alt="">Soundscaper</a>
		<nav aria-label="${escape(shell.mainNavigation)}"><a href="${editor}">${escape(shell.openBrowser)}</a><a href="/docs${handbookLanguagePath(locale)}/">${escape(shell.handbook)}</a>
		<details class="language-menu"><summary>${escape(copy.language)}</summary><ul>${AUDACITY_DOWNLOAD_LOCALES.map(language =>
		`<li><a href="${path(language.locale)}" lang="${language.locale}" dir="${language.direction}" hreflang="${language.locale}"${locale === language.locale ? ' aria-current="page"' : ''}>${escape(language.nativeName)}</a></li>`).join('')}</ul></details></nav>
	</header>
	<main id="main"><header class="intro"><p class="eyebrow">${escape(copy.eyebrow)}</p><h1>${escape(copy.heading)}</h1></header>
	<div class="download-columns">${(['soundscaper', 'audacity4', 'audacity3'] as const).map(id => {
		const release = releases[id];
		const selected = matchingDownload(release.assets, headers);
		const name = { soundscaper: 'Soundscaper', audacity4: 'Audacity 4', audacity3: 'Audacity 3' }[id];
		const options = release.assets.filter(asset => asset !== selected);
		const downloadLabel = `${escape(copy.download)} ${id === 'soundscaper' ? '' : 'Audacity '}<bdi>${escape(release.version)}</bdi> ↓`;
		const choices = `<details class="download-options" id="${id}-options"><summary${selected ? '' : ' class="download-main"'}>${selected ? `${escape(copy.other)} ${name}` : downloadLabel}</summary><nav aria-label="${escape(copy.formats)} ${name}"><ul>
		${options.map(asset => `<li><a href="${escape(asset.url)}">${escape(assetLabel(asset, copy))}</a></li>`).join('')}</ul></nav></details>`;
		return `<article class="download-card${id === 'soundscaper' ? ' recommended' : ''}" aria-labelledby="${id}-title">
		<h2 id="${id}-title">${id === 'soundscaper' ? `${escape(copy.soundscaper)} <span>${escape(copy.recommended)}</span>` : name}</h2>
		<p class="download-description">${id === 'soundscaper' ? `${escape(copy.fork)} <a href="${comparisonUrl}">${escape(copy.more)}</a>.`
			: id === 'audacity4' ? `Audacity <bdi>${escape(release.version)}</bdi>, ${escape(copy.latest)}` : escape(copy.classic)}</p>
		<div class="download-actions">${selected ? `<a class="download-main" href="${escape(selected.url)}" aria-describedby="${id}-note">${downloadLabel}</a>` : choices}
		${id === 'soundscaper' ? `<a class="online-button" href="${editor}">${escape(copy.online)}</a>` : ''}</div>
		<p class="download-note" id="${id}-note">${escape(selected ? assetLabel(selected, copy) : copy.mobile)}</p>
		${selected ? choices : ''}</article>`;
	}).join('')}</div>
	<section class="download-comparison" aria-label="${escape(copy.comparison)}">${renderComparison(locale, catalog)}
	<a href="${comparisonUrl}">${escape(copy.source)} →</a></section></main>
	<footer><span>Soundscaper · ${escape(shell.free)}</span><a href="/download/${locale}/">${escape(copy.soundscaper)}</a><a href="${privacyPolicyPath(locale)}">${escape(shell.privacy)}</a></footer>
</body></html>`;
}
