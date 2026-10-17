/* SPDX-License-Identifier: AGPL-3.0-only */

import { app } from 'electron/main';
import { startLightscaperDesktopMainCurrentV1 } from './lightscaper-main-host-current-v1.ts';
import { createLightscaperManagedSmokeHooksCurrentV1 } from './lightscaper-managed-smoke-main-current-v1.ts';
import { LIGHTSCAPER_MANAGED_SMOKE_RENDERER_SCRIPT_CURRENT_V1 } from './lightscaper-managed-smoke-renderer-script-current-v1.ts';

const hooks = createLightscaperManagedSmokeHooksCurrentV1({
	argv: process.argv, profilePath: app.getPath('userData'), rendererScript: LIGHTSCAPER_MANAGED_SMOKE_RENDERER_SCRIPT_CURRENT_V1,
	quit: () => { app.quit(); }, reportFailure: error => { console.error('Lightscaper managed smoke failed:', error); app.exit(1); },
});
startLightscaperDesktopMainCurrentV1(hooks);
