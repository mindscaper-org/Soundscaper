/* SPDX-License-Identifier: AGPL-3.0-only */

import { privacyPolicyPath } from './privacy-policy-path.ts';

export { privacyPolicyLocale, privacyPolicyPath } from './privacy-policy-path.ts';
import { productWebOrigin } from '../product-web-links.js';

export const PRIVACY_POLICY_REQUEST_EVENT = 'scape:privacy-policy-request';

export function privacyPolicyUrl(productId, locale = 'en') {
	return `${productWebOrigin(productId)}${privacyPolicyPath(locale)}`;
}
