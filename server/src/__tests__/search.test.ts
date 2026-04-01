import { searchController } from '../controllers/searchController';
import { Request, Response } from 'express';
import prisma from '../config/database';

// Mock prisma
jest.mock('../config/database', () => ({
  user: { findMany: jest.fn() },
  jobOpportunity: { findMany: jest.fn() },
  event: { findMany: jest.fn() },
  post: { findMany: jest.fn() },
}));

describe('Search Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    mockRequest = { query: { q: 'test' } };
    mockResponse = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
    jest.clearAllMocks();
  });

  it('should return empty results if query is too short', async () => {
    mockRequest.query = { q: 'a' };
    await searchController.globalSearch(mockRequest as Request, mockResponse as Response, nextFunction);
    
    expect(mockResponse.json).toHaveBeenCalledWith({
      success: true,
      data: { users: [], jobs: [], events: [], posts: [] }
    });
  });

  it('should call prisma findMany for all entities', async () => {
    (prisma.user.findMany as jest.Mock).mockResolvedValue([{ id: '1', fullName: 'Test User' }]);
    (prisma.jobOpportunity.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.event.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.post.findMany as jest.Mock).mockResolvedValue([]);

    await searchController.globalSearch(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(prisma.user.findMany).toHaveBeenCalled();
    expect(prisma.jobOpportunity.findMany).toHaveBeenCalled();
    expect(prisma.event.findMany).toHaveBeenCalled();
    expect(prisma.post.findMany).toHaveBeenCalled();
    expect(mockResponse.json).toHaveBeenCalled();
  });
});
