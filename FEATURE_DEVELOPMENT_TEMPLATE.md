# New Feature Development Template

## Quick Start: Adding New Features in 10 Steps

This template guides you through adding a new feature to the AITD Alumni Network.

### Example Feature: "Alumni Skill Endorsements"

---

## STEP 1: Create Prisma Model

**File:** `server/prisma/schema.prisma`

```prisma
model SkillEndorsement {
  id String @id @default(cuid())
  endorserId String
  endorser User @relation("SkillEndorser", fields: [endorserId], references: [id], onDelete: Cascade)
  endorseeId String
  endorsee User @relation("SkillEndorsee", fields: [endorseeId], references: [id], onDelete: Cascade)
  skill String
  category String
  createdAt DateTime @default(now())
  
  @@unique([endorserId, endorseeId, skill])
  @@index([endorseeId])
  @@index([skill])
  @@index([category])
}
```

---

## STEP 2: Run Database Migration

```bash
cd server
npm run db:migrate
# Type migration name: add_skill_endorsements
npm run db:generate
```

---

## STEP 3: Create Validator (Zod Schema)

**File:** `server/src/utils/validators.ts`

```typescript
export const endorseSkillSchema = z.object({
  skill: z.string().min(2).max(100),
  category: z.enum(['technical', 'leadership', 'communication', 'creative', 'other']),
});
```

---

## STEP 4: Create Controller

**File:** `server/src/controllers/endorsementController.ts`

```typescript
import { Request, Response } from 'express';
import prisma from '@/config/database';
import { successResponse, errorResponse, ErrorCode } from '@/utils/apiResponse';
import { parsePagination, getPaginationSkipTake, buildPaginationMeta } from '@/utils/pagination';

export const endorsementController = {
  // Get endorsements received
  getReceivedEndorsements: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { page = 1, limit = 20 } = req.query;
      
      const { page: pageNum, limit: limitNum } = parsePagination({ page, limit });
      const { skip, take } = getPaginationSkipTake(pageNum, limitNum);
      
      const [endorsements, total] = await Promise.all([
        prisma.skillEndorsement.findMany({
          where: { endorseeId: userId },
          skip,
          take,
          include: {
            endorser: { select: { id: true, name: true, profilePhoto: true } }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.skillEndorsement.count({ where: { endorseeId: userId } })
      ]);
      
      const pagination = buildPaginationMeta(pageNum, limitNum, total);
      
      return res.json(
        successResponse(endorsements, {
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
          pages: pagination.pages
        })
      );
    } catch (error) {
      return res.status(500).json(errorResponse(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch endorsements'
      ));
    }
  },

  // Get endorsements given
  getGivenEndorsements: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { page = 1, limit = 20 } = req.query;
      
      const { page: pageNum, limit: limitNum } = parsePagination({ page, limit });
      const { skip, take } = getPaginationSkipTake(pageNum, limitNum);
      
      const [endorsements, total] = await Promise.all([
        prisma.skillEndorsement.findMany({
          where: { endorserId: userId },
          skip,
          take,
          include: {
            endorsee: { select: { id: true, name: true, profilePhoto: true } }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.skillEndorsement.count({ where: { endorserId: userId } })
      ]);
      
      const pagination = buildPaginationMeta(pageNum, limitNum, total);
      
      return res.json(
        successResponse(endorsements, {
          page: pagination.page,
          limit: pagination.limit,
          total: pagination.total,
          pages: pagination.pages
        })
      );
    } catch (error) {
      return res.status(500).json(errorResponse(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch endorsements'
      ));
    }
  },

  // Create endorsement
  endorseSkill: async (req: Request, res: Response) => {
    try {
      const endorserId = req.user?.id;
      const { endorseeId } = req.params;
      const { skill, category } = req.body;

      // Prevent self-endorsement
      if (endorserId === endorseeId) {
        return res.status(400).json(errorResponse(
          ErrorCode.VALIDATION_ERROR,
          'Cannot endorse yourself'
        ));
      }

      // Check if user exists
      const endorsee = await prisma.user.findUnique({ where: { id: endorseeId } });
      if (!endorsee) {
        return res.status(404).json(errorResponse(
          ErrorCode.USER_NOT_FOUND,
          'User not found'
        ));
      }

      // Create or update endorsement
      const endorsement = await prisma.skillEndorsement.upsert({
        where: {
          endorserId_endorseeId_skill: {
            endorserId: endorserId!,
            endorseeId,
            skill
          }
        },
        create: {
          endorserId: endorserId!,
          endorseeId,
          skill,
          category
        },
        update: {
          skill,
          category
        }
      });

      return res.status(201).json(successResponse(endorsement));
    } catch (error) {
      return res.status(500).json(errorResponse(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to create endorsement'
      ));
    }
  },

  // Remove endorsement
  removeEndorsement: async (req: Request, res: Response) => {
    try {
      const userId = req.user?.id;
      const { endorsementId } = req.params;

      const endorsement = await prisma.skillEndorsement.findUnique({
        where: { id: endorsementId }
      });

      if (!endorsement) {
        return res.status(404).json(errorResponse(
          ErrorCode.RESOURCE_NOT_FOUND,
          'Endorsement not found'
        ));
      }

      if (endorsement.endorserId !== userId) {
        return res.status(403).json(errorResponse(
          ErrorCode.FORBIDDEN,
          'Cannot remove others\' endorsements'
        ));
      }

      await prisma.skillEndorsement.delete({ where: { id: endorsementId } });

      return res.json(successResponse({ message: 'Endorsement removed' }));
    } catch (error) {
      return res.status(500).json(errorResponse(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to remove endorsement'
      ));
    }
  },

  // Get top skills by category
  getTopSkills: async (req: Request, res: Response) => {
    try {
      const { category } = req.query;
      
      const topSkills = await prisma.skillEndorsement.groupBy({
        by: ['skill'],
        where: category ? { category: category as string } : {},
        _count: {
          skill: true
        },
        orderBy: {
          _count: {
            skill: 'desc'
          }
        },
        take: 20
      });

      return res.json(successResponse(topSkills));
    } catch (error) {
      return res.status(500).json(errorResponse(
        ErrorCode.INTERNAL_SERVER_ERROR,
        'Failed to fetch top skills'
      ));
    }
  }
};
```

---

## STEP 5: Create Routes

**File:** `server/src/routes/endorsementRoutes.ts`

```typescript
import { Router } from 'express';
import { endorsementController } from '@/controllers/endorsementController';
import { authenticate } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import { endorseSkillSchema } from '@/utils/validators';

const router = Router();

// Get endorsements
router.get('/endorsements/received', authenticate, endorsementController.getReceivedEndorsements);
router.get('/endorsements/given', authenticate, endorsementController.getGivenEndorsements);
router.get('/endorsements/top-skills', endorsementController.getTopSkills);

// Create/manage endorsements
router.post('/endorsements/:endorseeId', authenticate, validate(endorseSkillSchema), endorsementController.endorseSkill);
router.delete('/endorsements/:endorsementId', authenticate, endorsementController.removeEndorsement);

export default router;
```

---

## STEP 6: Add Routes to Main Router

**File:** `server/src/routes/index.ts`

```typescript
import endorsementRoutes from './endorsementRoutes';

// Add with other imports
router.use('/endorsements', endorsementRoutes);
```

---

## STEP 7: Create Tests

**File:** `server/src/__tests__/endorsement.test.ts`

```typescript
import request from 'supertest';
import app from '@/index';

describe('Endorsement Controller', () => {
  let token: string;
  let userId: string;
  let endorseeId: string;

  beforeAll(async () => {
    // Setup: Create test users and get tokens
    // ... authentication setup code
  });

  describe('POST /endorsements/:endorseeId', () => {
    it('should create skill endorsement', async () => {
      const res = await request(app)
        .post(`/endorsements/${endorseeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          skill: 'React',
          category: 'technical'
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.skill).toBe('React');
    });

    it('should prevent self-endorsement', async () => {
      const res = await request(app)
        .post(`/endorsements/${userId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          skill: 'React',
          category: 'technical'
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /endorsements/received', () => {
    it('should get received endorsements', async () => {
      const res = await request(app)
        .get('/endorsements/received')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
```

---

## STEP 8: Build & Verify

```bash
cd server
npm run build
npm run lint
npm run test
```

---

## STEP 9: Add Frontend Integration (Optional)

**File:** `client/src/api/endorsements.ts`

```typescript
import { API_URL } from '@/config';

export const endorsementAPI = {
  getReceivedEndorsements: (page = 1, limit = 20) =>
    fetch(`${API_URL}/endorsements/received?page=${page}&limit=${limit}`),

  getGivenEndorsements: (page = 1, limit = 20) =>
    fetch(`${API_URL}/endorsements/given?page=${page}&limit=${limit}`),

  endorseSkill: (endorseeId: string, skill: string, category: string) =>
    fetch(`${API_URL}/endorsements/${endorseeId}`, {
      method: 'POST',
      body: JSON.stringify({ skill, category })
    }),

  removeEndorsement: (endorsementId: string) =>
    fetch(`${API_URL}/endorsements/${endorsementId}`, {
      method: 'DELETE'
    }),

  getTopSkills: (category?: string) =>
    fetch(`${API_URL}/endorsements/top-skills${category ? `?category=${category}` : ''}`)
};
```

---

## STEP 10: Commit & Deploy

```bash
git add .
git commit -m "feat: add skill endorsement feature

- Create SkillEndorsement model
- Implement endorsement controller with CRUD operations
- Add endorsement routes
- Create pagination support
- Add comprehensive tests
- Support skill categorization and top skills tracking"

npm run build
npm run test
# Push to production
```

---

## Testing Checklist

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] API responses use standardized format
- [ ] Pagination working correctly
- [ ] Error handling working
- [ ] Authorization checks in place
- [ ] Input validation working
- [ ] Database constraints enforced
- [ ] Code builds without errors
- [ ] Linting passes

---

## Common Patterns

### Pattern 1: Authenticated Endpoint with Pagination

```typescript
router.get('/feature', authenticate, async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { page = 1, limit = 20 } = req.query;
  const { page: p, limit: l } = parsePagination({ page, limit });
  
  const [data, total] = await Promise.all([
    prisma.model.findMany({
      where: { userId },
      ...getPaginationSkipTake(p, l)
    }),
    prisma.model.count({ where: { userId } })
  ]);
  
  return res.json(successResponse(data, buildPaginationMeta(p, l, total)));
});
```

### Pattern 2: Create with Authorization Check

```typescript
router.post('/feature', authenticate, validate(schema), async (req, res) => {
  const userId = req.user?.id;
  
  try {
    const data = await prisma.model.create({
      data: { ...req.body, userId }
    });
    return res.status(201).json(successResponse(data));
  } catch (error) {
    return res.status(500).json(errorResponse(ErrorCode.INTERNAL_SERVER_ERROR, 'Error'));
  }
});
```

### Pattern 3: Update with Ownership Check

```typescript
router.patch('/feature/:id', authenticate, async (req, res) => {
  const userId = req.user?.id;
  const { id } = req.params;
  
  const existing = await prisma.model.findUnique({ where: { id } });
  if (!existing || existing.userId !== userId) {
    return res.status(403).json(errorResponse(ErrorCode.FORBIDDEN, 'Not authorized'));
  }
  
  const updated = await prisma.model.update({
    where: { id },
    data: req.body
  });
  
  return res.json(successResponse(updated));
});
```

---

## Quick Reference: Common Dependencies Already Installed

- **Validation:** Zod
- **ORM:** Prisma
- **Auth:** JWT, Passport
- **File Upload:** Multer, Sharp
- **Testing:** Jest, Supertest
- **API Documentation:** Can add Swagger if needed

---

## Next Steps

1. Choose a feature from `API_TESTING_AND_IMPROVEMENTS.md`
2. Follow this 10-step template
3. Test locally
4. Commit with descriptive message
5. Deploy to production

**Good luck! You're ready to build.**
