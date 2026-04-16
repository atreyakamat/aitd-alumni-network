const toInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const config = {
  port: toInt(process.env.PORT, 5000),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'default-refresh-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
  email: {
    from: process.env.EMAIL_FROM || 'noreply@aitdconnection.edu',
    smtp: {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: toInt(process.env.SMTP_PORT, 587),
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    sendgridApiKey: process.env.SENDGRID_API_KEY,
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
  },
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    region: process.env.AWS_REGION || 'ap-south-1',
    s3Bucket: process.env.AWS_S3_BUCKET || 'aitd-connection-uploads',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/api/auth/google/callback',
    mapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
  },
  linkedin: {
    clientId: process.env.LINKEDIN_CLIENT_ID || '',
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET || '',
    callbackUrl: process.env.LINKEDIN_CALLBACK_URL || 'http://localhost:5000/api/auth/linkedin/callback',
  },
  cache: {
    feedTtlSeconds: toInt(process.env.FEED_CACHE_TTL_SECONDS, 120),
  },
  image: {
    enableCompression: toBool(process.env.IMAGE_COMPRESSION_ENABLED, true),
    quality: toInt(process.env.IMAGE_QUALITY, 80),
    maxWidth: toInt(process.env.IMAGE_MAX_WIDTH, 1920),
    maxHeight: toInt(process.env.IMAGE_MAX_HEIGHT, 1920),
  },
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  nodeEnv: process.env.NODE_ENV || 'development',
};

export default config;
