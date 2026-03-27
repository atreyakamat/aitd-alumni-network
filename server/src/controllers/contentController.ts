import { Request, Response, NextFunction } from 'express';
import { galleryService } from '../services/galleryService';
import { newsService } from '../services/newsService';
import { chapterService } from '../services/chapterService';
import { marketplaceService } from '../services/marketplaceService';

// Gallery Controller
export class GalleryController {
  async getAlbums(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 12;
      const type = req.query.type as any;
      const result = await galleryService.getAlbums(page, limit, type);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getAlbum(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.getAlbum(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createAlbum(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await galleryService.createAlbum(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateAlbum(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.updateAlbum(id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteAlbum(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.deleteAlbum(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async addPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const { albumId } = req.params;
      const { url, thumbnailUrl, caption } = req.body;
      const result = await galleryService.addPhoto(albumId, req.user!.id, url, thumbnailUrl, caption);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deletePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.deletePhoto(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getRecentPhotos(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = parseInt(req.query.limit as string) || 8;
      const result = await galleryService.getRecentPhotos(limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

// News Controller
export class NewsController {
  async getArticles(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = {
        ...req.query,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 12,
      };
      const result = await newsService.getArticles(filters);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;
      const result = await newsService.getArticle(slug);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await newsService.createArticle(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await newsService.updateArticle(id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async publishArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await newsService.publishArticle(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async unpublishArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await newsService.unpublishArticle(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await newsService.deleteArticle(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getLatestNews(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = parseInt(req.query.limit as string) || 5;
      const result = await newsService.getLatestNews(limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

// Chapter Controller
export class ChapterController {
  async getChapters(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await chapterService.getChapters(page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getChapter(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await chapterService.getChapter(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createChapter(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await chapterService.createChapter(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateChapter(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await chapterService.updateChapter(id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteChapter(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await chapterService.deleteChapter(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async joinChapter(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await chapterService.joinChapter(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async leaveChapter(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await chapterService.leaveChapter(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getChapterMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const result = await chapterService.getChapterMembers(id, page, limit);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getUserChapters(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await chapterService.getUserChapters(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

// Marketplace Controller
export class MarketplaceController {
  async getListings(req: Request, res: Response, next: NextFunction) {
    try {
      const filters = {
        ...req.query,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 12,
      };
      const result = await marketplaceService.getListings(filters);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getListing(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await marketplaceService.getListing(id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async createListing(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await marketplaceService.createListing(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateListing(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await marketplaceService.updateListing(req.user!.id, id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteListing(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(req.user!.userRole);
      const result = await marketplaceService.deleteListing(req.user!.id, id, isAdmin);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getMyListings(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await marketplaceService.getMyListings(req.user!.id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async getCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await marketplaceService.getCategories();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const galleryController = new GalleryController();
export const newsController = new NewsController();
export const chapterController = new ChapterController();
export const marketplaceController = new MarketplaceController();
