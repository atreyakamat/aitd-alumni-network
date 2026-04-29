# AITD Alumni Network - Deployment Guide

## Overview
This is a full-stack application with a Next.js frontend and Express.js backend. This guide covers deployment to production at `aitd.stixnvibes.com`.

## Frontend Deployment (Netlify)

The Next.js frontend is deployed on Netlify and configured in `netlify.toml`.

### Configuration
- **Domain**: `aitd.stixnvibes.com` (via Netlify)
- **Build command**: `npm run build` (from client directory)
- **Publish directory**: `.next`
- **Node version**: 20
- **Environment variables** (set in Netlify dashboard):
  - `NEXT_PUBLIC_API_URL=https://api.aitd.stixnvibes.com/api`

### Steps to Deploy to Netlify

1. **Connect repository to Netlify**:
   - Go to https://netlify.com
   - Click "New site from Git"
   - Connect your GitHub repository
   - Select this repository

2. **Configure build settings**:
   - Base directory: `client`
   - Build command: `npm run build`
   - Publish directory: `.next`

3. **Set environment variables** in Netlify dashboard:
   ```
   NEXT_PUBLIC_API_URL=https://api.aitd.stixnvibes.com/api
   ```

4. **Connect custom domain**:
   - In Netlify dashboard, go to "Domain management"
   - Add custom domain: `aitd.stixnvibes.com`
   - Update DNS records with Netlify nameservers or CNAME

5. **Deploy**:
   - Push changes to main branch
   - Netlify automatically deploys

## Backend API Deployment

The Express.js API needs to be deployed separately. Choose one of these platforms:

### Option 1: Railway (Recommended - Easiest)

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Create Railway project**:
   ```bash
   railway init
   railway up
   ```

3. **Set environment variables** in Railway dashboard:
   - `DATABASE_URL`: Your MySQL connection string
   - `JWT_SECRET`: Your JWT secret key
   - `JWT_REFRESH_SECRET`: Your refresh token secret
   - `FRONTEND_URL`: `https://aitd.stixnvibes.com`
   - `CORS_ORIGINS`: `https://aitd.stixnvibes.com,http://localhost:3000`
   - `PORT`: 5000
   - `NODE_ENV`: `production`
   - Add other required env vars (Razorpay, OAuth, etc.)

4. **Get API URL**:
   - Railway provides a public URL like `api-xxx.up.railway.app`
   - Create CNAME: `api.aitd.stixnvibes.com` → Railway URL

### Option 2: Render.com

1. **Create new Web Service**:
   - Go to https://render.com
   - Click "New +" → "Web Service"
   - Connect GitHub repository

2. **Configure**:
   - Root directory: `server`
   - Build command: `npm run build`
   - Start command: `npm start`
   - Environment: Node
   - Plan: Free or Starter

3. **Set environment variables**:
   - Same as Railway (see above)

4. **Get URL and setup custom domain**:
   - Create CNAME record pointing to Render

### Option 3: DigitalOcean App Platform

1. **Create App**:
   - Go to https://cloud.digitalocean.com
   - Create → App Platform
   - Connect GitHub

2. **Configure**:
   - Select `server` directory
   - Build: `npm run build`
   - Run: `npm start`

3. **Set environment variables** and deploy

## Database Setup

The application uses MySQL. Ensure your database is configured and accessible.

### Required Environment Variables

**Server (.env)**:
```
DATABASE_URL=mysql://user:password@host:3306/database
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
FRONTEND_URL=https://aitd.stixnvibes.com
CORS_ORIGINS=https://aitd.stixnvibes.com
PORT=5000
NODE_ENV=production
```

**Client (.env)**:
```
NEXT_PUBLIC_API_URL=https://api.aitd.stixnvibes.com/api
```

## API Routes Summary

### Authentication Routes
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `POST /api/auth/refresh-token` - Refresh JWT token
- `GET /api/auth/me` - Get current user

### User Routes
- `GET /api/users/:id` - Get user profile
- `PATCH /api/users/profile` - Update profile
- `POST /api/users/work-experience` - Add work experience
- `GET /api/users/directory` - Search users

### Content Routes
- `GET /api/posts` - Get feed
- `POST /api/posts` - Create post
- `GET /api/jobs` - Get job listings
- `POST /api/jobs` - Post job
- `GET /api/events` - Get events
- `GET /api/news` - Get news articles

### Social Routes
- `GET /api/messages` - Get conversations
- `POST /api/messages/:receiverId` - Send message
- `GET /api/notifications` - Get notifications
- `GET /api/network/connections` - Get connections

### Payment Routes
- `POST /api/memberships/order` - Create membership order
- `POST /api/donations/order` - Create donation

## Health Check

Test your deployment:

```bash
# Frontend
curl https://aitd.stixnvibes.com

# Backend
curl https://api.aitd.stixnvibes.com/health
```

Response should be:
```json
{
  "status": "ok",
  "database": "mysql",
  "databaseStatus": "up",
  "timestamp": "2026-04-30T..."
}
```

## Verification Checklist

- [ ] Frontend loads at `aitd.stixnvibes.com`
- [ ] API responds at `https://api.aitd.stixnvibes.com/health`
- [ ] Database connection works
- [ ] User registration works
- [ ] Login functionality works
- [ ] CORS headers are correct
- [ ] SSL certificates are valid
- [ ] Environment variables are set correctly
- [ ] Rate limiting is working
- [ ] File uploads work

## Troubleshooting

### API Returns 503
- Check database connection string
- Verify MySQL server is running
- Check environment variables

### CORS Errors
- Verify `CORS_ORIGINS` includes `https://aitd.stixnvibes.com`
- Check browser console for exact error message

### Build Failures
- Run `npm run build` locally first
- Check Node version (should be 18+)
- Clear node_modules and reinstall

### SSL/Certificate Issues
- Netlify auto-renews SSL certificates
- For custom domain API, ensure DNS is properly configured
- Wait 24-48 hours for DNS propagation

## Production Best Practices

1. **Always use HTTPS** - Both frontend and API
2. **Set strong JWT secrets** - Use 32+ character random strings
3. **Enable rate limiting** - Already configured in Express middleware
4. **Monitor logs** - Set up Sentry or similar error tracking
5. **Regular backups** - Backup MySQL database regularly
6. **Keep dependencies updated** - Run `npm audit` regularly
7. **Use environment variables** - Never commit secrets
8. **Enable caching** - Static assets cached for 1 year
9. **Setup monitoring** - Track API response times and errors
10. **Document API changes** - Keep API documentation updated

## Rollback Instructions

If deployment causes issues:

1. **Netlify**: Simply deploy a previous commit
   - Go to Deploys → Select previous version → Restore

2. **API Server**: Stop current instance, restart previous version
   - Or redeploy previous commit to Railway/Render

## Support

For issues:
1. Check CloudFlare/DNS records
2. Verify all environment variables
3. Check application logs on Netlify/Railway/Render
4. Review browser console for client-side errors
5. Check API response headers and status codes
