import { Request, Response, NextFunction } from 'express';
import { userService } from '../services/userService';

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
      const result = await userService.searchDirectory(req.query as any);
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

  // Public Stats
  async getPublicStats(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await userService.getPublicStats();
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
}

export const userController = new UserController();
