/* SPDX-License-Identifier: AGPL-3.0-only */

import englishRows from './comparison-en.json' with { type: 'json' };
import germanRows from './comparison-de.json' with { type: 'json' };
import type { AudacityDownloadCatalog } from './localization.ts';

export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

/** Keep the comparison's reviewed versions and scope separate from live releases. */
export function renderComparison(locale: string, catalog: AudacityDownloadCatalog): string {
	const rows = locale === 'de' ? germanRows : englishRows;
	const translate = (text: string): string => {
		const key = Object.hasOwn(catalog.comparison, text) ? text : text.replaceAll("'", '’');
		return escapeHtml(catalog.comparison[key] ?? text);
	};
	const notes = Object.keys(catalog.comparison).slice(0, 5);
	return `<h2>${translate(notes[0])}</h2>
	<p>${translate(notes[1])}</p><p>${translate(notes[2])}
	<a href="https://github.com/audacity/audacity/blob/Audacity-4.0.2/CHANGELOG.txt">${translate(notes[3])}</a> ${translate(notes[4])}</p>
	<div class="comparison-scroll" tabindex="0" role="region" aria-label="${escapeHtml(catalog.copy.comparison)}">
	<table><thead><tr>${rows[0].map(cell => `<th scope="col">${translate(cell)}</th>`).join('')}</tr></thead>
	<tbody>${rows.slice(1).map(([feature, ...cells]) => {
		if (feature.startsWith('**')) return `<tr><th colspan="4">${translate(feature.replaceAll('**', ''))}</th></tr>`;
		return `<tr><th scope="row">${translate(feature)}</th>${cells.map(cell => {
			const match = /^(Yes|No|Partial|Ja|Nein|Teilweise)\b/iu.exec(cell);
			if (!match) return `<td>${translate(cell)}</td>`;
			const detail = cell.slice(match[0].length).replace(/^\s*[–—-]?\s*/u, '');
			const extra = /^(including JS scripting|and more added|also added spectral drawing|inklusive JS-Skripting|und mehr hinzugefügt|auch spektrales Zeichnen hinzugefügt)$/iu.test(detail);
			const status = /^(Yes|Ja)$/iu.test(match[0]) ? (extra ? 'extra' : 'yes') : /^(Partial|Teilweise)$/iu.test(match[0]) ? 'partial' : 'no';
			const symbol = { yes: '+', no: '/', partial: '~', extra: '★' }[status];
			return `<td class="comparison-cell--${status}"><span aria-hidden="true">${symbol}</span> <span class="status-label">${translate(match[0])}</span>${detail ? ` ${translate(detail)}` : ''}</td>`;
		}).join('')}</tr>`;
	}).join('')}</tbody></table></div>`;
}
