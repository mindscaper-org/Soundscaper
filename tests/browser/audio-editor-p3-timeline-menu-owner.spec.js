/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, clipByName, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

async function projectFile(id) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'take', title: 'Voice recording', sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const project = createSoundscaperProject({ id, title: id, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: [clip.id] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([new Float32Array(48_000).fill(.25)]); await writer.commit();
		const archive = await exportScapeProject(project, store);
		expect(archive.blob).toBeInstanceOf(Blob);
		return Buffer.from(await archive.blob.arrayBuffer()).toString('base64');
	} finally { await store.close(); }
}

async function launchProject(page, bytes) {
	await page.evaluate(bytes => {
		const body = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
		globalThis.__p3MenuLaunch({ files: [{ kind: 'file', getFile: () => Promise.resolve(
			new File([body], 'Programme.sscape', { type: 'application/x-scape-project' }),
		) }] });
	}, bytes);
}

for (const menu of ['track', 'clip', 'timeline', 'ruler']) {
	test(`OS File Open retires the outgoing ${menu} menu before it can edit a replacement recording`, async ({ page }) => {
		await page.addInitScript(() => Object.defineProperty(globalThis, 'launchQueue', {
			configurable: true, value: { setConsumer(consumer) { globalThis.__p3MenuLaunch = consumer; } },
		}));
		const outgoing = await projectFile('p3-menu-outgoing'), incoming = await projectFile('p3-menu-incoming');
		const editor = await bootEditor(page, '/embed/en/');
		await launchProject(page, outgoing);
		await expect(editor).toHaveAttribute('data-project-id', 'p3-menu-outgoing');
		await waitForProjectActivation(editor);
		let popup;
		if (menu === 'track') {
			await editor.locator('[data-track-row][data-track-id="voice"]').getByRole('button', { name: 'Track menu', exact: true }).click();
			popup = page.locator('.audio-editor-track-menu');
		} else if (menu === 'clip') {
			await clipByName(editor, 'Voice recording').locator('.clip-header').click({ button: 'right' });
			popup = page.locator('.audio-editor-clip-context-menu');
		} else if (menu === 'timeline') {
			await editor.locator('[data-ruler][role="region"]').click({ button: 'right', position: { x: 100, y: 5 } });
			popup = page.locator('.timeline-ruler-context-menu');
		} else {
			await editor.locator('[data-track-ruler]').first().click({ button: 'right' });
			popup = page.locator('.ruler-flyout');
		}
		await expect(popup).toBeVisible();
		await launchProject(page, incoming);
		await expect(editor).toHaveAttribute('data-project-id', 'p3-menu-incoming');
		await waitForProjectActivation(editor);
		await expect(popup).toHaveCount(0);
		await expect(editor.locator('[data-track-row][data-track-id="voice"]')).toBeVisible();
		await expect(clipByName(editor, 'Voice recording')).toBeVisible();
		await expect(editor).toHaveAttribute('data-clip-count', '1');
	});
}
