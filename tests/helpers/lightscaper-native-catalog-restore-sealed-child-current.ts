/* SPDX-License-Identifier: AGPL-3.0-only */

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import { createLightscaperNativeCatalogRestoreStageCurrentV1 as createStage,
	readLightscaperNativeCatalogRestoreAuditCurrentV1 as audit } from '../../desktop/lightscaper-native-catalog-restore-stage-current-v1.ts';
import { catalogRestoreRecordsCurrentV1 as records } from './lightscaper-native-catalog-restore-fixture-current.ts';
export interface LightscaperNativeCatalogRestoreSealedReportCurrentV1 {
	readonly initialized: boolean; readonly photoRefused: boolean; readonly pageRefused: boolean;
	readonly stageCloseFailed: boolean; readonly candidateCloseFailed: boolean;
}
const directory = process.argv[2]; if (!directory || !process.send) throw new Error('Native sealed-stage child requires its owned IPC and root.');
const send = process.send.bind(process), release = new Promise<void>(resolve => { process.once('message', () => { resolve(); }); });
const post = (value: Record<string, unknown>): Promise<void> => new Promise((resolve, reject) => { send(value, error => { if (error) reject(error); else resolve(); }); });
let owner: Scopes | undefined, initialized = false, photoRefused = false, pageRefused = false, stageCloseFailed = false, candidateCloseFailed = false, ownerCloseFailed = false;
try {
	owner = await Scopes.open({ appDataPath: directory }); const r = records(1), candidate = await owner.beginRestore(r.root.id);
	const stage = await createStage(candidate.catalogClaim, { root: r.root, savedState: null }); await stage.writePhoto(r.photos[0]); await stage.finish();
	const view = audit(stage, candidate.allocation), path = join(directory, 'Lightscaper', 'project-library', 'v1', 'native-photo-libraries',
		candidate.allocation.namespaceToken, 'app-data', 'Lightscaper', 'project-library', 'v1', 'native-photo-catalogs.sqlite3');
	const other = new DatabaseSync(path);
	try { other.prepare("UPDATE native_photos SET document=json_set(document,'$.metadata.title','same-revision mutation') WHERE photo_id=?").run(r.photos[0]!.id); }
	finally { other.close(); }
	try { await view.readPhoto(r.photos[0]!.id); } catch { photoRefused = true; }
	try { await view.readPhotoKeyPage(null); } catch { pageRefused = true; }
	try { await stage.close(); } catch { stageCloseFailed = true; }
	try { await candidate.close(); } catch { candidateCloseFailed = true; }
	initialized = true;
} catch { /* Parent inspects the closed scalar failure flags. */ }
await post({ phase: 'sealed', initialized, photoRefused, pageRefused, stageCloseFailed, candidateCloseFailed });
await release; if (owner) { try { await owner.close(); } catch { ownerCloseFailed = true; } }
await post({ phase: 'terminal', ownerCloseFailed }); process.disconnect?.();
