import { paginationHelper, buildPaginationResponse, slugify } from '../utils/helpers';

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

    it('should use default values', () => {
      const result = paginationHelper();
      expect(result.skip).toBe(0);
      expect(result.take).toBe(12);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(12);
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

  describe('slugify', () => {
    it('should generate slug from title', () => {
      const slug = slugify('Hello World Article');
      expect(slug).toBe('hello-world-article');
    });

    it('should handle special characters', () => {
      const slug = slugify('Test & Demo: Example!');
      expect(slug).toBe('test-demo-example');
    });

    it('should handle multiple spaces', () => {
      const slug = slugify('Multiple   Spaces   Here');
      expect(slug).toBe('multiple-spaces-here');
    });
  });
});
