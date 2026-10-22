/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { expect, test } from './audio-editor-test-fixtures.js';

test('solid meter transforms retain visible bounds', async ({ page }) => {
	const styles = await Promise.all(['02-overlays-search.css', '03-shell-toolbars-meters.css'].map(name =>
		readFile(new URL(`../../src/common/editor/ui/audio-editor-design-system/${name}`, import.meta.url), 'utf8')));
	await page.addStyleTag({ content: styles.join('\n') });
	const bounds = await page.evaluate(() => {
		const results = [];
		for (const orientation of ['horizontal', 'vertical']) {
			const surface = document.createElement('div');
			surface.className = `kw-audio-editor__playback-meter-surface kw-audio-editor__playback-meter-surface--${orientation}`;
			surface.dataset.meterStyle = 'default'; surface.dataset.meterType = 'db-log';
			const channel = document.createElement('div'); channel.style.cssText = 'position:relative;width:100px;height:100px';
			const fill = document.createElement('i'); fill.className = 'kw-audio-editor__playback-meter-peak';
			channel.append(fill); surface.append(channel); document.body.append(surface);
			for (const level of [0, 12.5, 55.5, 100]) {
				surface.style.setProperty('--playback-meter-peak', `${level}%`);
				surface.style.setProperty('--playback-meter-peak-transform', `${orientation === 'vertical' ? 'scaleY' : 'scaleX'}(${level / 100})`);
				surface.style.setProperty('--playback-meter-peak-origin', orientation === 'vertical' ? 'bottom' : 'left');
				fill.style.transition = 'none';
				const rect = fill.getBoundingClientRect(); const frame = channel.getBoundingClientRect();
				results.push({ orientation, level, width: rect.width, height: rect.height,
					x: rect.left - frame.left, bottom: frame.bottom - rect.bottom, layoutWidth: fill.offsetWidth, layoutHeight: fill.offsetHeight });
			}
			surface.remove();
		}
		return results;
	});
	for (const result of bounds) {
		expect(result.width).toBeCloseTo(result.orientation === 'horizontal' ? result.level : 100, 5);
		expect(result.height).toBeCloseTo(result.orientation === 'vertical' ? result.level : 100, 5);
		expect(result.x).toBe(0); expect(result.bottom).toBe(0);
		expect(result.layoutWidth).toBe(100); expect(result.layoutHeight).toBe(100);
	}
});
