/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../../src/framescaper/editor-project-native-media.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from '../../src/framescaper/editor-project-native-media-foundation.ts';
import { createFramescaperOpenFxExecutionForFoundationNativeMedia } from '../../src/framescaper/selected-native-media-openfx-execution.ts';
import type { CreateFramescaperOpenFxExactExecutionNativeMedia } from '../../src/framescaper/video-export-exact-execution-finishing.ts';

/** The preview host uses the same canonical native plan and finishing projection as the controller. */
export function nativeOpenFxVisualPreviewFixture(options: Parameters<typeof createFramescaperProjectNativeMedia>[1]) {
	const native = createFramescaperProjectNativeMedia(PROFILE, options);
	let executions = 0;
	const createOpenFxExecution: CreateFramescaperOpenFxExactExecutionNativeMedia = ({ foundationPlan, timingViews }) => (
		createFramescaperOpenFxExecutionForFoundationNativeMedia({ profile: PROFILE, project: native, foundationPlan, timingViews,
			execute: () => { executions += 1; return Promise.reject(new Error('The empty OpenFX graph must never execute.')); },
		})
	);
	return { project: framescaperProjectFinishingFoundationShapeNativeMedia(native), createOpenFxExecution,
		executionCount: () => executions };
}
