/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceWorkflowConsentAuthority,
} from '../desktop/assistance-workflow-consent.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

test('expiry and disposal invalidate workflow consent before execution', () => {
	let now = 5_000;
	let identity = 10;
	const authority = createAssistanceWorkflowConsentAuthority({
		now: () => now,
		mintGrantId: () => (++identity).toString(16).padStart(40, '0'),
	});
	const owner = {};
	const original = assistanceWorkflowFixture();
	const expired = authority.issue(owner, original);
	now = expired.expiresAtMs;
	assert.equal(authority.consume(owner, expired, original), false);
	authority.dispose();
	assert.throws(() => authority.issue(owner, original), /disposed/iu);
});
