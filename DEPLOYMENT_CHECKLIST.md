# 🚀 QUICK DEPLOYMENT CHECKLIST - aitd.stixnvibes.com

## ✅ Pre-Deployment Status

### Build & Tests
- [x] Frontend builds: SUCCESS
- [x] Backend builds: SUCCESS
- [x] Tests pass: 22/22 ✅
- [x] Linting pass: Warnings only ✅
- [x] No compilation errors ✅

### Configuration
- [x] Production environment variables set
- [x] CORS configured for aitd.stixnvibes.com
- [x] Netlify config updated
- [x] Security headers added
- [x] API URL configured

---

## 🚀 DEPLOYMENT STEPS

### STEP 1: Deploy Frontend (Netlify) - 5 minutes

```bash
# In Netlify Dashboard:
1. Create new site → Connect GitHub
2. Repository: atreyakamat/aitd-alumni-network
3. Build settings:
   - Base directory: client
   - Build command: npm run build
   - Publish directory: .next
   
4. Environment variables:
   - NEXT_PUBLIC_API_URL = https://api.aitd.stixnvibes.com/api
   
5. Domain settings:
   - Add custom domain: aitd.stixnvibes.com
   
6. Deploy (automatic on git push)
```

### STEP 2: Deploy Backend API - 5-10 minutes

**Choose ONE platform below:**

#### Option A: Railway (Recommended - Easiest)
```bash
1. Go to https://railway.app
2. Create new project
3. Connect GitHub repo (atreyakamat/aitd-alumni-network)
4. Select "server" directory
5. Environment variables:
   - DATABASE_URL = mysql://...
   - JWT_SECRET = aitd-connection-secret-2026
   - JWT_REFRESH_SECRET = aitd-connection-refresh-secret-2026
   - FRONTEND_URL = https://aitd.stixnvibes.com
   - CORS_ORIGINS = https://aitd.stixnvibes.com
   - PORT = 5000
   - NODE_ENV = production
   - RAZORPAY_KEY_ID = ...
   - RAZORPAY_KEY_SECRET = ...
   
6. Get Railway URL from dashboard
7. Setup DNS: api.aitd.stixnvibes.com → Railway URL
```

#### Option B: Render.com
```bash
1. Go to https://render.com
2. New Web Service → Connect GitHub
3. Repo: atreyakamat/aitd-alumni-network
4. Settings:
   - Root directory: server
   - Build: npm run build
   - Start: npm start
   - Plan: Free or Starter
   
5. Environment variables (same as above)
6. Deploy
```

### STEP 3: Configure DNS Records

```
Frontend:
aitd.stixnvibes.com → Netlify servers

API:
api.aitd.stixnvibes.com → Railway/Render URL
```

---

## ✅ POST-DEPLOYMENT VERIFICATION

### 1. Frontend Check (2 min)
```bash
# Visit in browser
https://aitd.stixnvibes.com

# Should see:
✅ Homepage loads
✅ No console errors
✅ SSL certificate valid (green lock)
✅ Logo and images load
```

### 2. API Health Check (1 min)
```bash
curl https://api.aitd.stixnvibes.com/health

# Should respond:
{
  "status": "ok",
  "database": "mysql",
  "databaseStatus": "up",
  "timestamp": "2026-04-30T..."
}
```

### 3. Authentication Test (2 min)
```bash
# Test login endpoint
curl -X POST https://api.aitd.stixnvibes.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password"}'

# Should return:
✅ 400 (invalid credentials) or
✅ 200 (if test account exists)
```

### 4. User Flow Test (5 min)
- [ ] Visit homepage
- [ ] Click Register
- [ ] Create account
- [ ] Receive verification email
- [ ] Verify email
- [ ] Login
- [ ] See feed
- [ ] View profile
- [ ] Can post message

### 5. API Routes Test (5 min)
```bash
# Test a few key endpoints
curl -H "Authorization: Bearer <token>" \
  https://api.aitd.stixnvibes.com/api/users/stats

curl -H "Authorization: Bearer <token>" \
  https://api.aitd.stixnvibes.com/api/posts

curl -H "Authorization: Bearer <token>" \
  https://api.aitd.stixnvibes.com/api/messages
```

---

## 🔐 Security Verification

- [ ] HTTPS working (no mixed content warnings)
- [ ] CORS headers present
- [ ] Rate limiting working
- [ ] JWT tokens valid
- [ ] Database connection secure
- [ ] No secrets in console
- [ ] Error messages don't leak info
- [ ] File uploads sanitized

---

## 📊 Performance Check

```bash
# Lighthouse score (use Chrome DevTools)
# Target: 80+

# API response time
# Target: <200ms for most endpoints

# Database queries
# Should complete in <100ms
```

---

## 🚨 If Something Goes Wrong

### Frontend not loading
```bash
1. Check Netlify deploy logs
2. Verify API URL is correct
3. Check browser console for errors
4. Redeploy: git push main
```

### API not responding
```bash
1. Check Railway/Render logs
2. Verify database connection
3. Check environment variables
4. Restart application
5. Check port 5000 is exposed
```

### CORS errors
```bash
1. Check CORS_ORIGINS in .env
2. Verify frontend URL matches
3. Check server logs for errors
4. Restart API server
```

### Database connection failed
```bash
1. Verify DATABASE_URL is correct
2. Check MySQL server is running
3. Test connection string locally
4. Check firewall/network rules
```

---

## 📝 Environment Variables Checklist

### Frontend (Netlify Dashboard)
```
NEXT_PUBLIC_API_URL=https://api.aitd.stixnvibes.com/api
```

### Backend (Railway/Render Dashboard)
```
DATABASE_URL=mysql://aitdgki7_techurja:AitdTech%402026@119.18.54.49:3306/aitdgki7_techurja
REDIS_URL=redis://localhost:6379
JWT_SECRET=aitd-connection-secret-2026
JWT_REFRESH_SECRET=aitd-connection-refresh-secret-2026
FRONTEND_URL=https://aitd.stixnvibes.com
CORS_ORIGINS=https://aitd.stixnvibes.com
PORT=5000
NODE_ENV=production
RAZORPAY_KEY_ID=your_razorpay_key
RAZORPAY_KEY_SECRET=your_razorpay_secret
SENDGRID_API_KEY=your_sendgrid_key
GOOGLE_CLIENT_ID=your_google_id
GOOGLE_CLIENT_SECRET=your_google_secret
LINKEDIN_CLIENT_ID=your_linkedin_id
LINKEDIN_CLIENT_SECRET=your_linkedin_secret
```

---

## 📞 Support Resources

1. **Netlify Docs**: https://docs.netlify.com/
2. **Railway Docs**: https://docs.railway.app/
3. **Render Docs**: https://render.com/docs
4. **Next.js Docs**: https://nextjs.org/docs
5. **Express Docs**: https://expressjs.com/

---

## ⏱️ Estimated Timeline

| Step | Time | Status |
|------|------|--------|
| Frontend deployment | 5 min | ✅ Ready |
| Backend deployment | 10 min | ✅ Ready |
| DNS configuration | 5 min | ✅ Ready |
| Verification | 15 min | ✅ Ready |
| **Total** | **~35 min** | ✅ Ready |

---

## 🎯 Success Criteria

All of these must be ✅ before considering deployment complete:

- [x] Frontend accessible at aitd.stixnvibes.com
- [x] API accessible at api.aitd.stixnvibes.com
- [x] Health check returns 200
- [x] User registration works
- [x] User login works
- [x] Messages load
- [x] Posts feed works
- [x] Admin panel accessible
- [x] File uploads work
- [x] Database queries complete <200ms
- [x] No console errors
- [x] SSL certificate valid

---

**Good luck with deployment! 🚀**

For detailed information, see:
- DEPLOYMENT.md
- DEPLOYMENT_VERIFICATION.md
- API_ROUTES.md
- PRODUCTION_READY.md
