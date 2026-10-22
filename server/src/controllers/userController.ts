import { Request, Response, NextFunction } from 'express';
import { userService, MapAudienceFilters } from '../services/userService';
import { followService } from '../services/followService';
import { uploadToStorage } from '../utils/storage';

/** A single, non-empty query-string value (repeated params arrive as arrays and are ignored). */
const queryString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** Parses an integer query value; NaN/absent becomes undefined. */
const queryInt = (value: unknown): number | undefined => {
  const str = queryString(value);
  if (str === undefined) return undefined;
  const n = parseInt(str, 10);
  return Number.isNaN(n) ? undefined : n;
};

const queryFloat = (value: unknown): number | undefined =>
  value === undefined ? undefined : parseFloat(String(value));

const MAP_FILTER_MAX_LENGTH = 100;

/** Batch/department/name filters shared by the map endpoints; returns an error message when invalid. */
const parseMapAudience = (query: Request['query']): { filters: MapAudienceFilters } | { error: string } => {
  const rawBatch = queryString(query.batchYear);
  const batchYear = rawBatch === undefined ? undefined : Number(rawBatch);
  if (batchYear !== undefined && (!Number.isInteger(batchYear) || batchYear < 1900 || batchYear > 2200)) {
    return { error: 'batchYear must be a valid year.' };
  }
  const department = queryString(query.department)?.slice(0, MAP_FILTER_MAX_LENGTH);
  const search = queryString(query.search)?.slice(0, MAP_FILTER_MAX_LENGTH);
  return { filters: { batchYear, department, search } };
};

const isImageUpload = (file: Express.Multer.File) => /^image\//i.test(file.mimetype || '');

export class UserController {
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const viewerId = req.user?.id;
      const [result, followStats] = await Promise.all([
        userService.getProfile(id, viewerId),
        followService.profileStats(id, viewerId),
      ]);
      res.json({ success: true, data: { ...result, ...followStats } });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.updateProfile(req.user!.id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateProfilePhoto(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      if (!isImageUpload(req.file)) {
        return res.status(400).json({ success: false, message: 'Profile photo must be an image' });
      }

      const photoUrl = await uploadToStorage(req.file, 'profiles');
      const result = await userService.updateProfilePhoto(req.user!.id, photoUrl);
      
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateCoverPhoto(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }
      if (!isImageUpload(req.file)) {
        return res.status(400).json({ success: false, message: 'Cover photo must be an image' });
      }

      const photoUrl = await uploadToStorage(req.file, 'covers');
      const result = await userService.updateCoverPhoto(req.user!.id, photoUrl);
      
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Work Experience
  async addWorkExperience(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.addWorkExperience(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateWorkExperience(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await userService.updateWorkExperience(req.user!.id, id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteWorkExperience(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await userService.deleteWorkExperience(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Education
  async addEducation(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.addEducation(req.user!.id, req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateEducation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await userService.updateEducation(req.user!.id, id, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  async deleteEducation(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const result = await userService.deleteEducation(req.user!.id, id);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Skills
  async updateSkills(req: Request, res: Response, next: NextFunction) {
    try {
      const { skills } = req.body;
      const result = await userService.updateSkills(req.user!.id, skills);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Directory
  async searchDirectory(req: Request, res: Response, next: NextFunction) {
    try {
      // Explicitly pick known filters; never spread raw query params into the service.
      const q = req.query;
      const filters = {
        name: queryString(q.name),
        department: queryString(q.department),
        city: queryString(q.city),
        company: queryString(q.company),
        skills: queryString(q.skills),
        page: queryInt(q.page) ?? 1,
        limit: queryInt(q.limit) ?? 12,
        batchYear: queryInt(q.batchYear),
        batchYearStart: queryInt(q.batchYearStart),
        batchYearEnd: queryInt(q.batchYearEnd),
        roleType: queryString(q.roleType),
        hometown: queryString(q.hometown),
        industry: queryString(q.industry),
        designation: queryString(q.designation),
        chapterId: queryString(q.chapterId),
      };
      const result = await userService.searchDirectory(filters);
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  // Yearbook
  async getYearbook(req: Request, res: Response, next: NextFunction) {
    try {
      const batchYear = Number(req.params.year);
      if (!Number.isInteger(batchYear) || batchYear < 1900 || batchYear > 2100) {
        return res.status(400).json({ success: false, message: 'year must be a valid batch year' });
      }
      const department = queryString(req.query.department);
      const result = await userService.getYearbook(batchYear, department);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Alumni Nearby
  async getAlumniLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const north = queryFloat(req.query.north);
      const south = queryFloat(req.query.south);
      const east = queryFloat(req.query.east);
      const west = queryFloat(req.query.west);
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : undefined;

      const hasBoundsParam = [north, south, east, west].some((value) => value !== undefined);
      const hasIncompleteBounds = [north, south, east, west].some((value) => value === undefined);

      if (hasBoundsParam && hasIncompleteBounds) {
        return res.status(400).json({
          success: false,
          message: 'Provide north, south, east, and west together for bounds filtering.',
        });
      }

      if ([north, south, east, west].some((value) => value !== undefined && Number.isNaN(value))) {
        return res.status(400).json({
          success: false,
          message: 'Bounds must be valid numbers.',
        });
      }

      const outOfRange =
        [north, south].some((v) => v !== undefined && Math.abs(v) > 90) ||
        [east, west].some((v) => v !== undefined && Math.abs(v) > 180);
      if (outOfRange) {
        return res.status(400).json({
          success: false,
          message: 'Latitude bounds must be within [-90, 90] and longitude bounds within [-180, 180].',
        });
      }

      if (north !== undefined && south !== undefined && north < south) {
        return res.status(400).json({
          success: false,
          message: 'north must be greater than or equal to south.',
        });
      }

      if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
        return res.status(400).json({
          success: false,
          message: 'limit must be a positive integer.',
        });
      }

      const audience = parseMapAudience(req.query);
      if ('error' in audience) {
        return res.status(400).json({ success: false, message: audience.error });
      }

      const result = await userService.getAlumniLocations({
        north,
        south,
        east,
        west,
        limit,
        ...audience.filters,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Nearby Alumni with geospatial filtering
  async getNearbyAlumni(req: Request, res: Response, next: NextFunction) {
    try {
      const lat = parseFloat(req.query.lat as string);
      const lng = parseFloat(req.query.lng as string);
      const radius = req.query.radius !== undefined ? parseFloat(req.query.radius as string) : undefined;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : undefined;

      if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return res.status(400).json({
          success: false,
          message: 'Valid lat and lng query parameters are required',
        });
      }

      if (radius !== undefined && (Number.isNaN(radius) || radius <= 0)) {
        return res.status(400).json({ success: false, message: 'radius must be a positive number (km).' });
      }

      if (limit !== undefined && (Number.isNaN(limit) || limit <= 0)) {
        return res.status(400).json({ success: false, message: 'limit must be a positive integer.' });
      }

      const audience = parseMapAudience(req.query);
      if ('error' in audience) {
        return res.status(400).json({ success: false, message: audience.error });
      }

      const result = await userService.getNearbyAlumni(lat, lng, radius, limit, audience.filters);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Public Stats
  async getPublicStats(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.getPublicStats();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Notable Alumni
  async getNotableAlumni(req: Request, res: Response, next: NextFunction) {
    try {
      const limit = queryInt(req.query.limit) ?? 6;
      const result = await userService.getNotableAlumni(limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
