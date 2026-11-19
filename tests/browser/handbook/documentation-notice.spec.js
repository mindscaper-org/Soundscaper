import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';

import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

const BASE = handbookPlan('soundscaper').scope;
const NOTICE = 'This documentation is AI-generated.';

test('identifies AI-generated documentation above the title on every page layout', async ({ page }) => {
	for (const route of [
		'',
		'soundscaper/recording/',
		'reference/generated/formats/',
		'start/how-soundscaper-compares/',
		'fr/soundscaper/recording/',
	]) {
		await page.goto(`${BASE}${route}`);
		const main = page.getByRole('main');
		const notice = main.getByRole('note').filter({ hasText: NOTICE });
		await expect(notice).toHaveCount(1);
		await expect(notice).toBeVisible();
		await expect(notice).toHaveAttribute('lang', 'en');
		const title = main.getByRole('heading', { level: 1 });
		await expect(title).toBeVisible();
		const noticeBox = await notice.boundingBox();
		const titleBox = await title.boundingBox();
		expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(titleBox.y);
	}
});
