import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/userService';
import { uploadToStorage } from '../utils/storage';

export class UserController {
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const viewerId = req.user?.id;
      const result = await userService.getProfile(id, viewerId);
      res.json({ success: true, data: result });
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
      const filters = {
        ...req.query,
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 12,
        batchYear: req.query.batchYear ? parseInt(req.query.batchYear as string) : undefined,
        batchYearStart: req.query.batchYearStart ? parseInt(req.query.batchYearStart as string) : undefined,
        batchYearEnd: req.query.batchYearEnd ? parseInt(req.query.batchYearEnd as string) : undefined,
        roleType: req.query.roleType as string,
        hometown: req.query.hometown as string,
        industry: req.query.industry as string,
        designation: req.query.designation as string,
        chapterId: req.query.chapterId as string,
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
      const batchYear = parseInt(req.params.year);
      const department = req.query.department as string | undefined;
      const result = await userService.getYearbook(batchYear, department);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }

  // Alumni Nearby
  async getAlumniLocations(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.getAlumniLocations();
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
      const radius = req.query.radius ? parseFloat(req.query.radius as string) : 50;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      if (isNaN(lat) || isNaN(lng)) {
        return res.status(400).json({
          success: false,
          message: 'Valid lat and lng query parameters are required',
        });
      }

      const result = await userService.getNearbyAlumni(lat, lng, radius, limit);
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
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 6;
      const result = await userService.getNotableAlumni(limit);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
