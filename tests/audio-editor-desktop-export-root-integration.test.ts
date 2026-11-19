/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type { DesktopAudioCodecCapabilityQuery } from '../desktop/desktop-audio-codec-capability-contract.ts';
import { createEditorRootDom, type EditorRootDom } from './helpers/editor-root-dom.ts';

type Mode = 'available' | 'missing' | 'unsupported' | 'probe-failed';

async function fixture(context: TestContext, mode: Mode, options: { video?: boolean; desktop?: boolean } = {}) {
	const dom = await createEditorRootDom(context);
	const { createRoot } = await import('react-dom/client');
	const { ExportDialog } = await import('../src/common/editor/ui/inspector/ExportDialog.jsx');
	const { ENGLISH_COPY } = await import('../src/common/i18n/catalogs.js');
	const state = { mode, installed: mode !== 'missing', installations: 0, queries: [] as DesktopAudioCodecCapabilityQuery[] };
	const status = () => ({ state: state.installed ? 'ready' : 'unconfigured', canInstall: true,
		location: state.installed ? '/usr/bin/ffmpeg' : null, detail: '' });
	// This is the original browser fixture's desktop bridge contract. The actual
	// shipping hook, selection controller, dialogs and delegated events remain real.
	const fileService = {
		isDesktop: options.desktop !== false,
		getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: Object.fromEntries(
			['mp4', 'webm', 'mov'].map(format => {
				const available = state.installed && !(state.mode === 'unsupported' && format === 'mov');
				return [format, { available, provider: available ? 'external-ffmpeg' : null,
					reason: available ? null : 'The configured FFmpeg does not expose the MOV muxer.' }];
			}),
		) }),
		getExternalFfmpegStatus: async () => status(),
		installExternalFfmpeg: async () => { state.installations += 1; state.installed = true; return status(); },
		getDesktopAudioCodecCapabilities: async (query: DesktopAudioCodecCapabilityQuery) => {
			state.queries.push(query);
			if (state.mode === 'probe-failed') throw new Error('Invalid desktop audio codec capability response');
			return { schemaVersion: 2, capabilities: query.operations.map(tuple => {
				if (tuple.format === 'mp3' && ![8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].includes(tuple.sampleRate)) {
					return { ...tuple, available: false, provider: null, reason: 'unsupported-settings' };
				}
				const unavailable = !state.installed || (state.mode === 'unsupported' && tuple.format === 'flac');
				return { ...tuple, available: !unavailable, provider: unavailable ? null : 'bundled',
					reason: !unavailable ? null : state.installed ? 'unsupported-by-configured-ffmpeg' : 'configure-external-ffmpeg',
					...(state.mode === 'unsupported' && tuple.format === 'flac' ? { missingCapabilities: ['encoder:flac'] } : {}),
				};
			}) };
		},
	};
	const requests: unknown[] = [];
	const controller = {
		subscribeTelemetry: () => () => undefined,
		getTelemetrySnapshot: () => ({ exportProgress: 0 }),
		actions: { export: {
			presets: { list: () => [], apply: () => { throw new Error('unused'); }, save: () => { throw new Error('unused'); },
				delete: () => { throw new Error('unused'); }, import: () => { throw new Error('unused'); }, saveToFile: () => { throw new Error('unused'); } },
			previewDeliveryCanvas: () => undefined,
			start: (request: unknown) => { requests.push(request); }, cancel: () => undefined,
		} },
	};
	const project = { id: 'desktop-codec-matrix', revision: 1, title: 'Desktop codec matrix', sampleRate: 48_000,
		masterChannels: 2, metadata: {}, loop: { enabled: false, startFrame: 0, endFrame: 48_000 }, selection: null,
		clips: [{ id: 'audio', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0 },
			...(options.video ? [{ id: 'video', kind: 'video', timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0 }] : [])],
		tracks: [{ id: 'audio', type: 'audio', clipIds: ['audio'] },
			{ id: 'labels', type: 'label', labels: [{ id: 'one', title: 'Opening chapter', startFrame: 0, endFrame: 48_000 }] },
			...(options.video ? [{ id: 'video', type: 'video', clipIds: ['video'] }] : [])],
	};
	const snapshot = { ready: true, importing: false, recording: false, processingEffect: false,
		missingSourceIds: [], exporting: false, export: { progress: 0, output: null }, selection: null,
		masteringSequences: { sequences: [] }, project };
	const container = dom.document.createElement('div'); dom.document.body.append(container);
	const root = createRoot(container);
	dom.onDispose(async () => { await dom.react.act(async () => root.unmount()); container.remove(); });
	await dom.react.act(async () => root.render(dom.react.createElement(ExportDialog, {
		isOpen: true, controller, snapshot, copy: ENGLISH_COPY, productId: 'soundscaper', fileService, onClose: () => undefined,
	})));
	const dialog = dom.element('[role="dialog"][aria-label="Export audio"]');
	const button = (label: string, parent: ParentNode = dom.document) => findButton(dom, label, parent);
	const choose = async (field: string, label: string) => {
		await dom.click(dom.element('button', dom.element(`[data-export-field="${field}"]`, dialog)));
		await dom.wait(() => [...dom.document.querySelectorAll('[role="option"]')].some(node => node.textContent?.trim() === label), `actual ${label} option is visible`);
		await dom.click(dom.byText('[role="option"]', label));
	};
	const problem = async (title: string) => {
		await dom.wait(() => !!dom.document.querySelector(`[role="alertdialog"][aria-label="${title}"]`), `actual ${title} problem appears`);
		return dom.element(`[role="alertdialog"][aria-label="${title}"]`);
	};
	const available = async () => {
		await dom.wait(() => !button('Export', dialog).disabled, 'the actual chosen format becomes exportable');
		assert.equal(dom.document.querySelector('[role="alertdialog"]') === null, true);
	};
	const healthy = () => { assert.deepEqual(requests, [], 'capability selection never starts an export'); dom.assertHealthy(); };
	return { dom, dialog, state, button, choose, problem, available, healthy };
}

function findButton(dom: EditorRootDom, label: string, root: ParentNode): HTMLButtonElement {
	const button = [...root.querySelectorAll('button')].filter(node => node.textContent?.trim() === label || node.getAttribute('aria-label') === label).at(-1);
	assert.ok(button instanceof dom.window.HTMLButtonElement, `Missing actual ${label} button`); return button;
}

test('real desktop MOV selection requires explicit installation and rechecks the selected muxer', async context => {
	const value = await fixture(context, 'missing', { video: true });
	await value.choose('format', 'MOV video');
	const problem = await value.problem('FFmpeg is not installed');
	assert.match(problem.textContent ?? '', /MOV video export requires FFmpeg/u);
	assert.equal(value.state.installations, 0);
	await value.dom.click(value.button('Install FFmpeg', problem));
	await value.available(); assert.equal(value.state.installations, 1);
	assert.match(value.dom.element('[data-export-field="format"]', value.dialog).textContent ?? '', /MOV video/u);
	value.healthy();
});

test('real browser format choices exclude desktop MOV while offering MP4', async context => {
	const value = await fixture(context, 'available', { video: true, desktop: false });
	await value.dom.click(value.dom.element('button', value.dom.element('[data-export-field="format"]', value.dialog)));
	const labels = [...value.dom.document.querySelectorAll('[role="option"]')].map(node => node.textContent?.trim());
	assert.ok(labels.includes('MP4 video')); assert.equal(labels.includes('MOV video'), false);
	value.healthy();
});

test('real desktop MOV refusal preserves the exact muxer cause and selection can recover to MP4', async context => {
	const value = await fixture(context, 'unsupported', { video: true });
	await value.choose('format', 'MOV video');
	const problem = await value.problem('MOV video export unavailable');
	assert.match(problem.textContent ?? '', /MOV muxer/u);
	assert.equal([...problem.querySelectorAll('button')].some(node => node.textContent?.includes('Install FFmpeg')), false);
	await value.dom.click(value.button('Close', problem));
	assert.equal(value.button('Export', value.dialog).disabled, true);
	await value.choose('format', 'MP4 video'); await value.available();
	value.healthy();
});

test('real desktop audio choices remain visible and AAC installation is opt in', async context => {
	const value = await fixture(context, 'missing');
	await value.dom.click(value.dom.element('button', value.dom.element('[data-export-field="format"]', value.dialog)));
	const labels = [...value.dom.document.querySelectorAll('[role="option"]')].map(node => node.textContent?.trim());
	for (const format of ['WAV', 'FLAC', 'MP3', 'Ogg Vorbis', 'Opus', 'WavPack', 'MP2', 'AAC / M4A']) assert.ok(labels.includes(format), format);
	await value.dom.click(value.dom.byText('[role="option"]', 'AAC / M4A'));
	const problem = await value.problem('FFmpeg is not installed');
	assert.match(problem.textContent ?? '', /AAC \/ M4A export requires FFmpeg/u); assert.equal(value.state.installations, 0);
	await value.dom.click(value.button('Install FFmpeg', problem)); await value.available();
	assert.equal(value.state.installations, 1); value.healthy();
});

test('real desktop audio capability refusal preserves the encoder name and exact recovered MP3 settings', async context => {
	const value = await fixture(context, 'unsupported');
	await value.choose('format', 'FLAC'); const problem = await value.problem('FLAC export unavailable');
	assert.match(problem.textContent ?? '', /encoder:flac/u);
	assert.equal([...problem.querySelectorAll('button')].some(node => node.textContent?.includes('Install FFmpeg')), false);
	await value.dom.click(value.button('Close', problem)); assert.equal(value.button('Export', value.dialog).disabled, true);
	await value.choose('format', 'MP3'); await value.available();
	assert.deepEqual(value.state.queries.at(-1)?.operations[0]?.settings, { preset: 2 }); value.healthy();
});

test('real desktop probe failures preserve their actual cause and recover on native WAV selection', async context => {
	const value = await fixture(context, 'probe-failed');
	await value.choose('format', 'Opus'); const problem = await value.problem('Opus export unavailable');
	assert.match(problem.textContent ?? '', /Invalid desktop audio codec capability response/u);
	assert.equal([...problem.querySelectorAll('button')].some(node => node.textContent?.includes('Install FFmpeg')), false);
	await value.dom.click(value.button('Close', problem));
	await value.choose('format', 'WAV'); await value.available(); value.healthy();
});

test('real sample-rate drafts suppress capability interruptions until blur and admit a corrected tuple', async context => {
	const value = await fixture(context, 'available');
	await value.choose('format', 'MP3'); await value.available();
	const input = value.dom.element('[data-export-field="sampleRate"] input', value.dialog);
	assert.ok(input instanceof value.dom.window.HTMLInputElement);
	await value.dom.setValue(input, ''); await value.dom.setValue(input, '96000');
	assert.equal(value.dom.document.querySelector('[role="alertdialog"]') === null, true);
	await value.dom.react.act(async () => { input.blur(); });
	const problem = await value.problem('MP3 export unavailable'); assert.match(problem.textContent ?? '', /96000 Hz/u);
	await value.dom.click(value.button('Close', problem));
	await value.dom.setValue(input, '48000'); await value.dom.react.act(async () => { input.blur(); });
	await value.available(); assert.equal(value.state.queries.at(-1)?.operations[0]?.sampleRate, 48_000); value.healthy();
});

test('real desktop chapter opt in survives MP3 to M4A and hides for split stems', async context => {
	const value = await fixture(context, 'available');
	assert.equal(value.dialog.querySelector('[data-export-field="embedLabelChapters"]') === null, true);
	await value.choose('format', 'MP3'); await value.available();
	const checkbox = value.dom.element('[data-export-field="embedLabelChapters"] [role="checkbox"]', value.dialog);
	assert.equal(checkbox.getAttribute('aria-checked'), 'false');
	await value.dom.click(checkbox); assert.equal(checkbox.getAttribute('aria-checked'), 'true');
	await value.choose('format', 'AAC / M4A'); await value.available();
	assert.equal(value.dom.element('[data-export-field="embedLabelChapters"] [role="checkbox"]', value.dialog).getAttribute('aria-checked'), 'true');
	await value.choose('output', 'Individual stems (split by tracks)');
	assert.equal(value.dialog.querySelector('[data-export-field="embedLabelChapters"]') === null, true); value.healthy();
});
