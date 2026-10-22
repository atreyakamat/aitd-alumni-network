import { Request, Response, NextFunction } from 'express';
import { galleryService } from '../services/galleryService';
import { newsService } from '../services/newsService';
import { chapterService } from '../services/chapterService';
import { marketplaceService } from '../services/marketplaceService';
import { uploadToStorage } from '../utils/storage';
import { Actor, isAdminRole } from '../config/permissions';

const actorOf = (req: Request): Actor => ({ id: req.user!.id, userRole: req.user!.userRole });
const viewerOf = (req: Request): Actor | null => (req.user ? actorOf(req) : null);
const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
const queryInt = (value: unknown, fallback: number): number => {
  const n = parseInt(value as string, 10);
  return Number.isFinite(n) ? n : fallback;
};

// Gallery Controller
export class GalleryController {
  async getAlbums(req: Request, res: Response, next: NextFunction) {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 12;
      const type = req.query.type as any;
      const result = await galleryService.getAlbums(page, limit, type, queryString(req.query.search));
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getAlbum(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.getAlbum(id, viewerOf(req));
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
      // Admin route is POST /gallery/photos/admin, so the album comes from the body
      const albumId = req.params.albumId || req.body?.albumId;
      const { url, thumbnailUrl, caption } = req.body || {};
      const result = await galleryService.addPhoto(albumId, actorOf(req), url, thumbnailUrl, caption);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deletePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.deletePhoto(id, actorOf(req));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // User photo upload (for batch memories)
  async userAddPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const { albumId } = req.params;
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: 'No photos uploaded' });
      }

      // Check permission before anything is written to storage
      const actor = actorOf(req);
      await galleryService.assertCanAddPhoto(albumId, actor);

      const photos = [];
      for (const file of files) {
        const photoUrl = await uploadToStorage(file, 'gallery');
        const photo = await galleryService.addPhoto(
          albumId,
          actor,
          photoUrl,
          photoUrl,
          req.body.caption
        );
        photos.push(photo);
      }

      res.status(201).json({ success: true, data: photos });
    } catch (error) {
      next(error);
    }
  }

  // User can delete their own photos
  async userDeletePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await galleryService.userDeletePhoto(id, actorOf(req));
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
        category: queryString(req.query.category) as any,
        status: queryString(req.query.status) as any,
        search: queryString(req.query.search),
        page: queryInt(req.query.page, 1),
        limit: queryInt(req.query.limit, 12),
      };
      const result = await newsService.getArticles(filters, viewerOf(req));
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getArticle(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;
      const result = await newsService.getArticle(slug, viewerOf(req));
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
      const result = await chapterService.getChapters(page, limit, {
        search: queryString(req.query.search),
        region: queryString(req.query.region),
      });
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
      const result = await chapterService.updateChapter({ id: req.user!.id, userRole: req.user!.userRole }, id, req.body);
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
        type: queryString(req.query.type) as any,
        category: queryString(req.query.category),
        location: queryString(req.query.location),
        search: queryString(req.query.search),
        page: queryInt(req.query.page, 1),
        limit: queryInt(req.query.limit, 12),
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
      const result = await marketplaceService.getListing(id, viewerOf(req));
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
      const result = await marketplaceService.updateListing(actorOf(req), id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteListing(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const isAdmin = isAdminRole(req.user!.userRole);
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
