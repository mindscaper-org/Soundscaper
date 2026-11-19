/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SESSION_SNAPSHOT_COPY_BY_LOCALE } from '../src/common/i18n/editor-session-snapshot-copy.ts';
import { TRACK_PLAYLIST_COPY_BY_LOCALE } from '../src/common/i18n/editor-track-playlist-copy.ts';
import { SUBPROJECT_COPY_BY_LOCALE } from '../src/common/i18n/editor-subproject-copy.ts';
import { MATCH_EQ_COPY } from '../src/common/i18n/editor-match-eq-copy.ts';
import { RECORDING_COPY_BY_LOCALE } from '../src/common/i18n/recording-copy.js';
import { EXPORT_FORMAT_COPY_BY_LOCALE } from '../src/common/i18n/export-format-copy.js';
import { SPATIAL_RENDER_COPY } from '../src/common/i18n/editor-spatial-render-copy.ts';
import { APPLICATION_MENU_REFERENCE_BY_ID } from '../src/common/editor/ui/application-menu-reference.ts';
import { handbookTranslationLocales } from '../scripts/lib/handbook-locales.mjs';
import { parseProvenance, stripProvenance } from '../scripts/docs-ai/provenance.mjs';
import { checkTranslation } from '../scripts/docs-ai/workflows.mjs';

const root = new URL('../handbook/src/content/docs/', import.meta.url);
const guides = [
	['save-session-snapshots', 'session-snapshots', [SESSION_SNAPSHOT_COPY_BY_LOCALE.en.create, SESSION_SNAPSHOT_COPY_BY_LOCALE.en.restore, 'Undo']],
	['compare-track-playlists', 'track-playlists', [TRACK_PLAYLIST_COPY_BY_LOCALE.en.duplicate, TRACK_PLAYLIST_COPY_BY_LOCALE.en.activate, TRACK_PLAYLIST_COPY_BY_LOCALE.en.original]],
	['reuse-a-subproject', 'subprojects', [SUBPROJECT_COPY_BY_LOCALE.en.insert, SUBPROJECT_COPY_BY_LOCALE.en.pin, SUBPROJECT_COPY_BY_LOCALE.en.detach]],
	['punch-and-roll-narration', null, ['Record options', RECORDING_COPY_BY_LOCALE.en.leadInTimeOption, RECORDING_COPY_BY_LOCALE.en.punchAgain]],
	['process-one-clip', 'panel-clip-properties', ['Effects', 'Undo', 'tail']],
	['match-a-voice-recording', 'match-eq', [MATCH_EQ_COPY.effectMatchEqLearn, MATCH_EQ_COPY.effectMatchEqAnalyze, 'Apply to selection']],
	['align-a-dialogue-take', 'align-dialogue', ['Analyze and align', 'Play aligned', 'Create aligned copy']],
	['reduce-microphone-bleed', 'automatic-microphone-bleed-reduction', ['Create gain envelopes', 'Clip gain', 'Undo']],
	['edit-a-transcript', 'transcript-based-editing', ['Generate transcript', 'Backspace', 'desktop']],
	['denoise-during-playback', null, ['AI denoising (DPDFNet2)', 'desktop', 'Model Manager']],
	['restore-damaged-speech', null, ['Enhance Dialogue', 'VoiceFixer', 'Review result']],
	['turn-audio-into-midi', 'local-assistance', ['Audio to MIDI (Basic Pitch)', 'Accept proposal', 'Piano roll (beta)']],
	['play-midi-instruments', 'new-midi-track', ['Instrument', 'Instrument settings', 'desktop']],
	['import-a-daw-session', 'delivery-report', ['Delivery Report', '.rpp', '.nhsx', '.ptx', '.ardour', '.sesx']],
	['inspect-live-audio', 'analysis', ['Spectrum', 'ACX compliance', 'Check audio']],
	['find-expensive-effects', 'cpu-profiling', ['CPU', 'elapsed', 'playback']],
	['export-a-seamless-loop', null, [EXPORT_FORMAT_COPY_BY_LOCALE.en.renderAsLoop, 'WAV', 'tail']],
	['use-desktop-plugins', null, ['Plugin Manager', 'VST2', 'VST3', 'yabridge']],
	['recover-an-audacity-project', 'recover-audacity-project', ['.aup3', 'copy', 'report']],
	['edit-a-collapsed-folder', null, ['folder', 'collapsed', 'Undo']],
	['export-adm-speaker-audio', null, ['ADM', SPATIAL_RENDER_COPY.earRenderer, 'layout']],
] as const;

for (const [slug, commandId, terms] of guides) {
	test(`${slug} is a discoverable how-to with current commands and a usable outcome`, async () => {
		const page = await readFile(new URL(`soundscaper/${slug}.md`, root), 'utf8');
		assert.match(page, /^---\ntitle: .+\ndescription: .+\ndiataxis: how-to\n/u);
		assert.match(page, /\n## Before you start\n/u);
		assert.match(page, /\n## Steps\n\n1\. /u);
		assert.match(page, /\n## Check the result\n/u);
		assert.match(page, /\n## Limits and recovery\n/u);
		assert.ok([...page.matchAll(/^\d+\. /gmu)].length >= 3, 'give the reader actionable steps');
		for (const term of terms) assert.ok(page.includes(term), `missing user-facing guidance: ${term}`);
		if (commandId) {
			const command = APPLICATION_MENU_REFERENCE_BY_ID[commandId];
			assert.ok(command, `unknown command: ${commandId}`);
			assert.ok(command.locations.some(location => page.includes(`**${location} > ${command.label}**`)),
				'opening instruction must match the reviewed runtime menu path');
		}
		const index = await readFile(new URL('soundscaper/index.md', root), 'utf8');
		assert.ok(index.includes(`](/soundscaper/${slug}/)`), 'readers need a link from the Soundscaper overview');
		assert.doesNotMatch(page, /tests\/|src\/common\/|data-testid|TODO|TBD/u);
	});
}

// Newly published handbook languages may still use the normal English fallback.
const translatedFeatureLocales = new Set([
	'de', 'ar', 'cs', 'el', 'en-GB', 'es', 'fa', 'fi', 'fr', 'gl', 'he', 'hi', 'hy', 'id',
	'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW',
]);
for (const locale of handbookTranslationLocales().filter(locale => translatedFeatureLocales.has(locale))) {
	test(`${locale} has current translations for every feature how-to and the overview`, async () => {
		const catalogPath = new URL(`../src/common/i18n/translations/${locale}.json`, import.meta.url);
		const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as { entries: Record<string, readonly [string, string, string]> };
		const captions = new Map<string, Set<string>>();
		for (const [, english, translated] of Object.values(catalog.entries)) {
			const values = captions.get(english) ?? new Set<string>();
			values.add(translated);
			captions.set(english, values);
		}
		for (const slug of ['index', ...guides.map(([id]) => id)]) {
			const path = `soundscaper/${slug}.md`;
			const result = await checkTranslation({
				sourcePath: new URL(path, root),
				targetPath: new URL(`${locale.toLowerCase()}/${path}`, root),
			});
			assert.equal(result.status, 'current', `${locale}/${path}: ${result.status}`);
			const target = await readFile(new URL(`${locale.toLowerCase()}/${path}`, root), 'utf8');
			const source = await readFile(new URL(path, root), 'utf8');
			const captionCount = (markdown: string) => [...stripProvenance(markdown).matchAll(/\*\*[^*]+\*\*/gu)].length;
			assert.equal(captionCount(target), captionCount(source), `${locale}/${path}: retain emphasized controls`);
			const emphasized = (markdown: string) => [...stripProvenance(markdown).matchAll(/\*\*([^*]+)\*\*/gu)].map(match => match[1]!);
			const sourceCaptions = emphasized(source);
			const translatedCaptions = emphasized(target);
			const matches = (caption: string, translated: string) => {
				const parts = caption.split(' > '), translatedParts = translated.split(' > ');
				// Scoped UI strings can retain English even when another scope translates the same word.
				return parts.length === translatedParts.length && parts.every((part, index) =>
					part === translatedParts[index] || captions.get(part)?.has(translatedParts[index]!));
			};
			for (const caption of sourceCaptions) {
				assert.ok(translatedCaptions.some(translated => matches(caption, translated)),
					`${locale}/${path}: retain current UI caption ${caption}`);
			}
			for (const caption of translatedCaptions) {
				assert.ok(sourceCaptions.some(sourceCaption => matches(sourceCaption, caption)),
					`${locale}/${path}: UI caption does not match the app catalog: ${caption}`);
			}
			const provenance = parseProvenance(target);
			assert.equal(provenance?.sourceLocale, 'en');
			assert.equal(provenance?.targetLocale, locale);
		}
	});
}
