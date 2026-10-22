/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { mountedMacroManagerFixture, macroSnapshot, click } from './helpers/macro-manager-fixture.tsx';
import { reactProps } from './helpers/react-test-dom.ts';

for (const field of ['source', 'name'] as const) test(`MP48: Macro Manager reports a ${field} edit beyond the stored program limit`, async () => {
	const fixture = await mountedMacroManagerFixture();
	try {
		await fixture.render(macroSnapshot('project'));
		await act(async () => { fixture.scripts.save({ name: 'Program', source: '// Original' }); });
		await click(fixture.program('Program'));
		await act(async () => {
			if (field === 'source') {
				const input = fixture.find('[data-macro-script-source]'); assert.ok(input);
				reactProps(input).onChange({ target: { value: 'x'.repeat(256 * 1024 + 1) } });
			} else {
				const input = fixture.scriptNameInput();
				reactProps(input).onChange({ target: { value: 'x'.repeat(257) } });
			}
		});
		if (field === 'name') await act(async () => { reactProps(fixture.scriptNameInput()).onBlur(); });
		assert.match(fixture.message(), field === 'source' ? /too large/iu : /too long/iu);
		assert.equal(fixture.scripts.list()[0]?.name, 'Program');
		assert.equal(fixture.scripts.list()[0]?.source, '// Original');
		await act(async () => { const input = fixture.find('[data-macro-script-source]'); assert.ok(input);
			reactProps(input).onChange({ target: { value: '// Recovered' } }); });
		assert.equal(fixture.scripts.list()[0]?.source, '// Recovered');
	} finally { fixture.settlePending(); await fixture.cleanup(); }
});
