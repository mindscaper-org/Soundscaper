/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { lightTheme } from '../vendor/audacity-design-system/tokens/src/themes/light.v2.ts';
import { wcagContrastRatio } from '../src/common/editor/ui/theme-contrast.ts';

test('light secondary labels clear AA on every panel and table surface', () => {
	const table = lightTheme.background.table;
	const surfaces = {
		...lightTheme.background.surface,
		table: table.background,
		tableHeader: table.header.background,
		tableHover: table.row.hover,
		tableSelected: table.row.selected,
		tableAlternate: table.row.alternate,
	};
	for (const color of [lightTheme.foreground.text.secondary, table.cell.textSecondary]) {
		for (const [name, background] of Object.entries(surfaces)) {
			const ratio = wcagContrastRatio(color, background);
			assert.ok(ratio >= 4.5, `${name}: ${color} on ${background} is ${ratio.toFixed(2)}:1`);
		}
	}
	assert.equal(lightTheme.foreground.icon.secondary, '#6F788F');
});
