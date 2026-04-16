import { Request, Response, NextFunction } from 'express';
import { postService } from '../services/postService';
import { uploadToStorage } from '../utils/storage';
import { invalidateCache } from '../middleware/cache';

export class PostController {
  async getFeed(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await postService.getFeed(req.user?.id, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getPost(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await postService.getPost(id, req.user?.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createPost(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await postService.createPost(req.user!.id, req.body);
      await invalidateCache('cache:/api/posts*');
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updatePost(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await postService.updatePost(req.user!.id, id, req.body, isAdmin);
      await invalidateCache('cache:/api/posts*');
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deletePost(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await postService.deletePost(req.user!.id, id, isAdmin);
      await invalidateCache('cache:/api/posts*');
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async likePost(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await postService.likePost(req.user!.id, id);
      await invalidateCache('cache:/api/posts*');
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async addComment(req: Request, res: Response, next: NextFunction) {
    try {
      const { postId } = req.params;
      const { content, parentId } = req.body;
      const result = await postService.addComment(req.user!.id, postId, content, parentId);
      await invalidateCache('cache:/api/posts*');
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteComment(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await postService.deleteComment(req.user!.id, id, isAdmin);
      await invalidateCache('cache:/api/posts*');
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async uploadMedia(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
        return res.status(400).json({ success: false, message: 'No files uploaded' });
      }

      const files = req.files as Express.Multer.File[];
      const uploadPromises = files.map(file => uploadToStorage(file, 'posts'));
      const urls = await Promise.all(uploadPromises);

      res.json({ success: true, data: { urls } });
    } catch (error) {
      next(error);
    }
  }
}

export const postController = new PostController();
