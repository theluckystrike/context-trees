import { describe, expect, it } from 'vitest';
import { findMentions } from '../src/search';

describe('Unicode mention boundaries', () => {
	it('rejects letters outside the BMP on either side of a name', () => {
		const hits = findMentions(['Café', '𐐀Café', 'Café𐐀', '😀Café😀', 'Café\u0301'], ['Café'], new Map());
		expect(hits).toEqual([{ line: 0, ranges: [[0, 4]] }, { line: 3, ranges: [[2, 6]] }]);
	});
});
