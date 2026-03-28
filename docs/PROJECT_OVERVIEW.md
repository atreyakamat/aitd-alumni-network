# Alumni Connect - Project Documentation

A comprehensive alumni network platform for engineering colleges.

---

## 📁 Project Structure

```
aitd-alumni-network/
├── client/                    # Next.js Frontend
│   ├── src/
│   │   ├── app/              # App Router pages
│   │   │   ├── (auth)/       # Login, Register, etc.
│   │   │   ├── (dashboard)/  # Protected dashboard pages
│   │   │   └── (public)/     # Public landing pages
│   │   ├── components/       # React components
│   │   │   ├── ui/          # shadcn/ui components
│   │   │   └── ...          # Feature components
│   │   ├── lib/              # Utilities & API client
│   │   └── types/            # TypeScript types
│   └── public/               # Static assets
├── server/                    # Express Backend
│   ├── src/
│   │   ├── controllers/      # Route handlers (14 files)
│   │   ├── services/         # Business logic (14 files)
│   │   ├── middleware/       # Auth, validation, errors
│   │   ├── routes/           # API routes (index.ts)
│   │   ├── config/           # Database, Passport config
│   │   └── utils/            # Helpers, validators
│   └── prisma/               # Database schema & migrations
├── docs/                      # Documentation
│   ├── GETTING_STARTED.md    # Setup guide
│   ├── FEATURE_STATUS.md     # Implementation status
│   └── API_TEST_REPORT.md    # Test results
└── package.json              # Workspace configuration
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js v18+
- MySQL 8.0+
- Git

### Installation

```bash
# 1. Clone the repo
git clone https://github.com/atreyakamat/aitd-alumni-network.git
cd aitd-alumni-network

# 2. Install all dependencies
npm install

# 3. Set up MySQL database
mysql -u root -p
> CREATE DATABASE alumni_connect;
> exit

# 4. Configure environment
copy server\.env.example server\.env
# Edit server\.env with your MySQL credentials:
# DATABASE_URL="mysql://root:YOUR_PASSWORD@localhost:3306/alumni_connect"

# 5. Run database migrations
cd server
npx prisma migrate dev
npx prisma generate
cd ..

# 6. Start development servers
npm run dev
```

### Access the Application

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:5000/api |
| Health Check | http://localhost:5000/health |

---

## 🔑 API Authentication

### Register a New User
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!",
    "fullName": "John Doe",
    "batchYear": 2020,
    "department": "Computer Science",
    "degree": "B.Tech"
  }'
```

### Login
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePass123!"
  }'
```

### Using Access Token
```bash
curl -X GET http://localhost:5000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

---

## 📊 Feature Modules

### Core Features (100+ API endpoints)

| Module | Endpoints | Description |
|--------|-----------|-------------|
| **Auth** | 8 | Register, login, JWT refresh, password reset |
| **User Profile** | 10 | Profile, work experience, education, skills |
| **Social Feed** | 8 | Posts, likes, comments |
| **Directory** | 3 | Search, filters, yearbook |
| **Jobs** | 8 | Job posting, applications, admin approval |
| **Events** | 7 | Events, RSVP |
| **Gallery** | 5 | Albums, photos |
| **News** | 5 | Articles, publishing |
| **Donations** | 7 | Payment integration, donor wall |
| **Chapters** | 7 | Regional/industry groups |
| **Marketplace** | 7 | Business listings |
| **Messaging** | 6 | Direct messages |
| **Network** | 6 | Connections, requests |
| **Notifications** | 5 | In-app notifications |
| **Memberships** | 7 | Tiers, payments |

---

## 🗃️ Database Schema

### Core Models (25+ Prisma models)

```
User
├── WorkExperience[]
├── Education[]
├── UserSkill[]
├── Post[]
├── Connection[]
├── Message[]
├── Notification[]
├── EventRSVP[]
├── Donation[]
├── ChapterMembership[]
└── MarketplaceListing[]

Post
├── PostLike[]
└── PostComment[]

Event
└── EventRSVP[]

Chapter
└── ChapterMembership[]

MembershipTier
└── UserMembership[]
```

### Key Enums

```typescript
UserRole: MEMBER | CHAPTER_ADMIN | ADMIN | SUPER_ADMIN
RoleType: STUDENT | ALUMNI | FACULTY
PostType: GENERAL | JOB | BUSINESS | ANNOUNCEMENT
JobType: FULL_TIME | PART_TIME | INTERNSHIP | CONTRACT | FREELANCE | VOLUNTEER | MENTORSHIP
EventType: ONLINE | OFFLINE | HYBRID
ChapterType: REGIONAL | INDUSTRY | INTEREST
```

---

## 🔒 Security Features

- **JWT Authentication**: Access tokens (15 min) + Refresh tokens (7 days)
- **Password Hashing**: bcrypt with salt rounds
- **Rate Limiting**: 10 auth requests / 15 min, 100 API requests / 15 min
- **Input Validation**: Zod schema validation on all routes
- **CORS**: Configurable origin whitelist
- **Helmet**: Security headers middleware

---

## 🧪 Testing the API

### PowerShell Test Example

```powershell
# Register
$reg = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/register" `
  -Method POST `
  -Body (@{
    email="test@example.com";
    password="Test123!";
    fullName="Test User";
    batchYear=2020;
    department="CS";
    degree="B.Tech"
  } | ConvertTo-Json) `
  -ContentType "application/json"

# Login
$login = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login" `
  -Method POST `
  -Body (@{email="test@example.com";password="Test123!"} | ConvertTo-Json) `
  -ContentType "application/json"

$token = $login.data.accessToken
$headers = @{ Authorization = "Bearer $token" }

# Create a post
Invoke-RestMethod -Uri "http://localhost:5000/api/posts" `
  -Method POST `
  -Headers $headers `
  -Body (@{content="Hello Alumni!";type="GENERAL"} | ConvertTo-Json) `
  -ContentType "application/json"
```

---

## 📝 Common Commands

```bash
# Development
npm run dev           # Start both frontend and backend
npm run dev:client    # Start frontend only
npm run dev:server    # Start backend only

# Database
cd server
npx prisma studio     # Visual database browser
npx prisma migrate dev --name <name>  # Create migration
npx prisma generate   # Regenerate client

# Build
npm run build         # Build both packages

# Lint
npm run lint          # Lint all packages
```

---

## 🌐 Environment Variables

### Server (.env)

```env
# Database
DATABASE_URL="mysql://user:pass@localhost:3306/alumni_connect"

# JWT
JWT_SECRET="your-secret-key"
JWT_REFRESH_SECRET="your-refresh-secret"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"

# Server
PORT=5000
NODE_ENV="development"
FRONTEND_URL="http://localhost:3000"

# Razorpay (optional)
RAZORPAY_KEY_ID="your-key-id"
RAZORPAY_KEY_SECRET="your-secret"

# Email (optional)
SMTP_HOST="smtp.example.com"
SMTP_PORT=587
SMTP_USER="user"
SMTP_PASS="pass"
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [GETTING_STARTED.md](./GETTING_STARTED.md) | Detailed setup guide |
| [FEATURE_STATUS.md](./FEATURE_STATUS.md) | PRD implementation status |
| [API_TEST_REPORT.md](./API_TEST_REPORT.md) | API testing results |
| [AlumniConnect_PRD_v1.0.md](../AlumniConnect_PRD_v1.0.md) | Product Requirements |
| [Design.md](../Design.md) | UI/UX design guidelines |
| [Tech Stack.md](../Alumni%20Connect%20Tech%20Stack.md) | Technology choices |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -m "Add my feature"`
4. Push to branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

This project is proprietary software for AITD Alumni Network.
