import { describe, expect, it } from 'vitest';
import vectors from './vectors/context-trees.json';
import { trees, type TreesOptions } from '../src/reference';

describe('golden vectors (packages/spec/vectors/context-trees.json)', () => {
	it('has at least 20 cases', () => {
		expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
	});
	for (const c of vectors.cases) {
		it(c.name, () => {
			const [markdown, query, opts] = c.args as [string, string, TreesOptions | undefined];
			const got = trees(markdown, query, opts);
			const want = c.expected as { outline: string[]; hits: number };
			expect({ outline: got.outline, hits: got.hits }).toEqual(want);
		});
	}
});
