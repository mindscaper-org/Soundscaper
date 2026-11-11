import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { docsSchema } from '@astrojs/starlight/schema';
import { handbookContentPlan } from '../../scripts/lib/handbook-product-content.mjs';
import { webBuildProductId } from '../../scripts/lib/product-web-routing.mjs';

const plan = handbookContentPlan(webBuildProductId());

export const collections = {
	docs: defineCollection({
		loader: glob({
			base: './src/content/docs',
			pattern: [...plan.patterns],
			...(plan.generateId ? { generateId: plan.generateId } : {}),
		}),
		schema: docsSchema({
			extend: z.object({
				layoutPreset: z.enum(['default', 'full-width']).default('default'),
			}),
		}),
	}),
};
