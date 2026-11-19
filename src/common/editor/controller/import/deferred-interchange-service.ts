/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDeferredModuleFacade } from '../shared/deferred-module-facade.ts';
import type { NativeProjectServiceRuntime } from '../document/native-project-types.ts';
import type { SesxServiceHelpers } from './internal/sesx/sesx-service.ts';

/** Keep interchange readers and staging outside the editor's startup graph. */
export function createDeferredInterchangeService(runtime: NativeProjectServiceRuntime, helpers: SesxServiceHelpers) {
	return createDeferredModuleFacade(async () => {
		const { createTimelineInterchangeService } = await import('./internal/interchange/timeline-interchange-service.ts');
		return createTimelineInterchangeService(runtime, helpers);
	}, ['openInterchange']);
}
