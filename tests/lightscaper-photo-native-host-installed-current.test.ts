/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativePhotoHostServicesCurrentV1 as Host } from '../desktop/lightscaper-native-photo-host-services-current-v1.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { withLightscaperNativePhotoLinkedInputCurrentV1 as withInput } from '../desktop/lightscaper-native-photo-linked-input-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { normalizePhotoDocumentCurrentV1 } from '../src/lightscaper/catalog/photo-document-current-v1.ts';
import { scopePhotoCurrentV1, scopeOriginalReferenceCurrentV1 as reference } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';
import { grantedFsPathCurrentV1 as path } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
import { photoNativeDeploymentFixtureCurrentV1 as fixture, PHOTO_NATIVE_TEST_CURRENT_V1 as options,
	photoNativeHashCurrentV1 as hash } from './helpers/lightscaper-photo-native-deployment-fixture-current.ts';

/** The actual producer result is staged and authenticated, then the production
 * Host service factory supplies both genuine prepared roles to real selected
 * Scopes/Components. No test launcher, services DTO or successful decoder is substituted. */
void test('Installed Photo Host services activate actual selected FS grants and isolated native RAW across component reopen', options, async context => fixture(context, async f => {
	await f.stage(); const seed = scopePhotoCurrentV1(), fileName = 'Installed linked input.dng';
	await writeFile(join(f.directory, fileName), seed.bytes, { flag: 'wx' }); let choices = 0;
	const host = f.own(new Host({ applicationRoot: f.applicationRoot, resourcesPath: join(f.directory, 'resources'), packaged: false,
		chooseLinkedRoot: async signal => { signal?.throwIfAborted(); choices++; return { path: path(f.directory), displayName: 'Actual installed Photo root' }; } }));
	const services = await f.track(host.services()); assert.equal(await host.services(), services);
	assert.equal(typeof services.prepareGrantedFilesystem, 'function'); assert.equal(typeof services.prepareRaw, 'function'); assert.equal(choices, 0);
	assert.equal(f.activeChildren(), 0);
	const scopes = f.own(await Scopes.open({ appDataPath: join(f.directory, 'app-data'), services }));
	const selected = await scopes.openSelected({ name: 'Installed selected library', signal: f.scope.signal });
	let published: ReturnType<typeof normalizePhotoDocumentCurrentV1> | undefined;
	for (let pass = 0; pass < 2; pass++) {
		const current = await scopes.openSelected({ name: 'Same installed selection', signal: f.scope.signal }); assert.equal(current.selectionToken, selected.selectionToken);
		const c = f.own(await scopes.openComponents(current.scope, { signal: f.scope.signal }));
		try {
			assert.ok(c.linked); assert.ok(c.rawParts); assert.equal(f.activeChildren(), 1, 'One genuine retained FS broker belongs to these selected components.');
			const grant = await c.linked.grants.authorize({ signal: f.scope.signal }); assert.ok(grant);
			const input = f.own(await c.linked.originals.prepareInput(grant.grantId, [path(fileName)], { signal: f.scope.signal }));
			try { assert.equal(input.facts.contentSha256, seed.photo.original.contentSha256);
				await withInput(input, paths(join(f.directory, 'app-data')).databasePath, async source => { const bytes = await source.read(0, seed.bytes.byteLength);
					try { assert.equal(hash(bytes), hash(seed.bytes)); } finally { bytes.fill(0); } }, { signal: f.scope.signal });
			} finally { await input.close(); }
			if (pass === 0) {
				published = normalizePhotoDocumentCurrentV1({ ...seed.photo, catalogId: selected.catalogId, id: 'installed-managed-photo',
					original: { ...seed.photo.original, id: 'installed-managed-original', storageKey: 'installed-managed-asset' } });
				await c.media.writeAsset(published.original.storageKey, seed.blob);
				await c.media.catalogOriginals.retain(selected.catalogId, [reference(published.original, published.id)]);
				const root = await c.catalog.loadCatalog(selected.catalogId); assert.ok(root); await c.catalog.publishPhotos(selected.catalogId, root.revision, [published]);
			}
			assert.ok(published); const photo = await c.catalog.loadPhoto(selected.catalogId, published.id); assert.ok(photo);
			const opened = await f.track(c.rawParts.transport.open({ kind: 'frame', request: { catalogId: selected.catalogId, photoId: photo.id,
				original: photo.original, expectedRevision: photo.revision, profile: 'canonical' } }, { signal: f.scope.signal }));
			assert.equal(opened.outcome, 'ready'); if (opened.outcome !== 'ready') assert.fail('Actual staged native RAW must be available.');
			try {
				assert.equal(opened.ticket.decoder.engine, 'lightscaper-libraw-native'); assert.equal(opened.ticket.descriptor.sampleFormat, 'unorm16');
				assert.equal(opened.ticket.descriptor.width, 32); assert.equal(opened.ticket.descriptor.height, 32);
				assert.equal(f.activeChildren(), 1, 'The genuine isolated RAW child and stdio have exited while the FS broker remains owned.');
				const digest = createHash('sha256'); let nonzero = false;
				for (let offset = 0; offset < opened.ticket.byteLength; offset += 1024 * 1024) {
					const bytes = await c.rawParts.transport.read({ id: opened.ticket.id }, offset, Math.min(1024 * 1024, opened.ticket.byteLength - offset));
					try { nonzero ||= bytes.some(value => value !== 0); digest.update(bytes); } finally { bytes.fill(0); }
				} assert.equal(nonzero, true); assert.equal(digest.digest('hex'), opened.ticket.contentSha256);
			} finally { await c.rawParts.transport.close({ id: opened.ticket.id }); }
		} finally { await c.close(); }
		assert.equal(f.activeChildren(), 0);
	}
	assert.equal(choices, 2); await scopes.close(); await host.close(); assert.equal(f.activeChildren(), 0);
}));
