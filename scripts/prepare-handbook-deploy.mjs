#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { prepareHandbookDeployment } from './lib/handbook-deploy.ts';

console.log(`Prepared the independent handbook at ${await prepareHandbookDeployment()}.`);
