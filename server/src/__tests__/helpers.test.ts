import { paginationHelper, buildPaginationResponse, generateSlug, formatCurrency } from '../utils/helpers';

describe('Helpers', () => {
  describe('paginationHelper', () => {
    it('should calculate skip and take for page 1', () => {
      const result = paginationHelper(1, 10);
      expect(result.skip).toBe(0);
      expect(result.take).toBe(10);
    });

    it('should calculate skip and take for page 2', () => {
      const result = paginationHelper(2, 10);
      expect(result.skip).toBe(10);
      expect(result.take).toBe(10);
    });

    it('should handle different page sizes', () => {
      const result = paginationHelper(3, 25);
      expect(result.skip).toBe(50);
      expect(result.take).toBe(25);
    });

    it('should default to page 1 if invalid', () => {
      const result = paginationHelper(0, 10);
      expect(result.skip).toBe(0);
    });
  });

  describe('buildPaginationResponse', () => {
    const mockData = [
      { id: '1', name: 'Item 1' },
      { id: '2', name: 'Item 2' },
    ];

    it('should build pagination response', () => {
      const result = buildPaginationResponse(mockData, 50, 1, 10);
      
      expect(result.data).toEqual(mockData);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.hasNextPage).toBe(true);
      expect(result.pagination.hasPrevPage).toBe(false);
    });

    it('should indicate no next page on last page', () => {
      const result = buildPaginationResponse(mockData, 20, 2, 10);
      
      expect(result.pagination.hasNextPage).toBe(false);
      expect(result.pagination.hasPrevPage).toBe(true);
    });
  });

  describe('generateSlug', () => {
    it('should generate slug from title', () => {
      const slug = generateSlug('Hello World Article');
      expect(slug).toMatch(/^hello-world-article-[a-z0-9]+$/);
    });

    it('should handle special characters', () => {
      const slug = generateSlug('Test & Demo: Example!');
      expect(slug).toMatch(/^test-demo-example-[a-z0-9]+$/);
    });

    it('should handle multiple spaces', () => {
      const slug = generateSlug('Multiple   Spaces   Here');
      expect(slug).toMatch(/^multiple-spaces-here-[a-z0-9]+$/);
    });
  });

  describe('formatCurrency', () => {
    it('should format INR currency', () => {
      const formatted = formatCurrency(1234.56);
      expect(formatted).toContain('1,234.56');
    });

    it('should format USD currency', () => {
      const formatted = formatCurrency(1234.56, 'USD');
      expect(formatted).toContain('1,234.56');
    });

    it('should handle zero', () => {
      const formatted = formatCurrency(0);
      expect(formatted).toContain('0');
    });
  });
});
