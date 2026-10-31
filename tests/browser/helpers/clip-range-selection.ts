/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, type Locator, type Page } from '@playwright/test';
import { chooseTrackMenuAction } from './track-menu.js';

interface RangeGeometry {
	readonly startX: number;
	readonly endX: number;
	readonly left: number;
	readonly right: number;
	readonly scrollLeft: number;
	readonly scale: number;
}

/** Expose both authored endpoints outside the timeline's sticky track header. */
export function clipRangeRevealScrollLeft(geometry: RangeGeometry): number {
	const { startX, endX, left, right, scrollLeft, scale } = geometry;
	const delta = startX < left + 4 ? startX - left - 4 : endX > right - 4 ? endX - right + 4 : 0;
	return Math.max(0, scrollLeft + delta / scale);
}

export async function selectClipRange(page: Page, editor: Locator, clip: Locator,
	start: number, end: number): Promise<void> {
	for (const label of ['Clip gain', 'Split tool']) {
		const tool = editor.getByRole('button', { name: label, exact: true });
		if (await tool.getAttribute('aria-pressed') === 'true') await tool.click();
	}
	const row = clip.locator('xpath=ancestor::*[@data-track-row][1]');
	if (await row.locator('[data-track-automation-controls]').isVisible()) {
		await chooseTrackMenuAction(page, editor, row, 'Add automation');
		await expect(row.locator('[data-track-automation-controls]')).toHaveCount(0);
	}
	await clip.scrollIntoViewIfNeeded();
	const read = () => clip.evaluate((element, range) => {
		const lane = element.closest('[data-track-lane]');
		const scroll = element.closest<HTMLElement>('.audio-editor-timeline-scroll');
		const header = element.closest('[data-track-row]')?.querySelector('[data-track-header]');
		if (!lane || !scroll || !header) throw new Error('A clip range requires its visible timeline lane.');
		const bounds = element.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
		const laneBounds = lane.getBoundingClientRect();
		const startX = bounds.left + bounds.width * range.start, endX = bounds.left + bounds.width * range.end;
		const y = bounds.top + bounds.height * .58;
		const left = Math.max(viewport.left, laneBounds.left, header.getBoundingClientRect().right);
		const right = Math.min(viewport.right, laneBounds.right);
		const inspectHit = (x: number) => {
			const hit = element.ownerDocument.elementFromPoint(x, y), owner = hit?.closest('[data-clip-id]');
			return { tag: hit?.tagName, className: hit?.getAttribute('class'), clipId: owner?.getAttribute('data-clip-id'),
				ready: hit?.closest('[data-track-lane]') === lane && (!owner || owner === element)
					&& !hit?.closest('button, input, select, textarea, .clip-header, [data-track-automation-interactive]'),
			};
		};
		const startHit = inspectHit(startX), endHit = inspectHit(endX);
		return { startX, endX, y, left, right, scrollLeft: scroll.scrollLeft,
			scale: Number(scroll.dataset.timelineScrollScale) || 1, startHit, endHit,
			ready: startX > left && endX < right && y > Math.max(viewport.top, laneBounds.top)
				&& y < Math.min(viewport.bottom, laneBounds.bottom) && startHit.ready && endHit.ready,
		};
	}, { start, end });
	const initial = await read();
	await editor.locator('.audio-editor-timeline-scroll').evaluate((scroll, left) => {
		scroll.scrollTo({ left, behavior: 'instant' });
	}, clipRangeRevealScrollLeft(initial));
	await expect.poll(read, 'Both clip range endpoints must be exposed in their timeline lane.').toMatchObject({ ready: true });
	const target = await read();
	await page.mouse.move(target.startX, target.y);
	await page.mouse.down();
	await page.mouse.move(target.endX, target.y, { steps: 5 });
	await page.mouse.up();
	await expect(editor.locator('[data-time-selection-overlay]')).not.toHaveCount(0);
}
