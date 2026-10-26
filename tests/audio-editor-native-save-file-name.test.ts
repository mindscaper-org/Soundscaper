/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { ensureAup4FileName } from '../src/common/editor/controller/shared/app-helpers.ts';
import { createFixture, project } from './helpers/native-project-service-fixture.ts';

test('the desktop Audacity 4 save menu replaces a title ending in an Audacity 3 suffix', async () => {
	for (const title of ['Take.aup3', 'Take.AUP3']) {
		let opened = false;
		const fixture = createFixture({
			getProject: () => ({ ...project(), title }),
			ensureAup4FileName,
			fileService: {
				isDesktop: true,
				async chooseSaveTarget(request) {
					opened = true;
					assert.equal(request.purpose, 'aup4');
					assert.equal(request.suggestedName, 'Take.aup4');
					return null;
				},
				prepareSave: async () => ({ mode: 'cancelled', cancelled: true, fileName: '' }),
				saveFile: async () => ({}),
			},
		});
		// Rename Project accepts this title; the existing save menu passes it unchanged.
		const service = createNativeProjectService(fixture.runtime);
		assert.deepEqual(await service.saveAup4(), { cancelled: true });
		assert.equal(opened, true);
	}
});
