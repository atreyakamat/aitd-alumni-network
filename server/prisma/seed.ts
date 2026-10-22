import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create membership tiers
  const generalTier = await prisma.membershipTier.upsert({
    where: { name: 'General Member' },
    update: {
      description: 'Basic free membership for all registered alumni',
      priceInr: 0,
      durationMonths: null,
      benefits: [
        'Basic profile',
        'Directory access',
        'Notice board participation',
        'Event RSVP',
        'Basic messaging',
      ],
      badgeColor: '#6B7280',
      displayOrder: 1,
    },
    create: {
      name: 'General Member',
      description: 'Basic free membership for all registered alumni',
      priceInr: 0,
      durationMonths: null, // Lifetime
      benefits: [
        'Basic profile',
        'Directory access',
        'Notice board participation',
        'Event RSVP',
        'Basic messaging',
      ],
      badgeColor: '#6B7280',
      displayOrder: 1,
    },
  });

  const silverTier = await prisma.membershipTier.upsert({
    where: { name: 'Silver Member' },
    update: {
      description: 'Annual premium membership with enhanced features',
      priceInr: 1000,
      durationMonths: 12,
      benefits: [
        'All General benefits',
        'Priority job listings',
        'Exclusive event invites',
        'Enhanced profile visibility',
        'Priority support',
      ],
      badgeColor: '#9CA3AF',
      displayOrder: 2,
    },
    create: {
      name: 'Silver Member',
      description: 'Annual premium membership with enhanced features',
      priceInr: 1000,
      durationMonths: 12,
      benefits: [
        'All General benefits',
        'Priority job listings',
        'Exclusive event invites',
        'Enhanced profile visibility',
        'Priority support',
      ],
      badgeColor: '#9CA3AF',
      displayOrder: 2,
    },
  });

  const goldTier = await prisma.membershipTier.upsert({
    where: { name: 'Gold Member' },
    update: {
      description: 'Lifetime premium membership with full access',
      priceInr: 4000,
      durationMonths: null,
      benefits: [
        'All Silver benefits',
        'Featured profile',
        'Marketplace priority listing',
        'Exclusive networking events',
        'Direct admin contact',
      ],
      badgeColor: '#F59E0B',
      displayOrder: 3,
    },
    create: {
      name: 'Gold Member',
      description: 'Lifetime premium membership with full access',
      priceInr: 4000,
      durationMonths: null, // Lifetime
      benefits: [
        'All Silver benefits',
        'Featured profile',
        'Marketplace priority listing',
        'Exclusive networking events',
        'Direct admin contact',
      ],
      badgeColor: '#F59E0B',
      displayOrder: 3,
    },
  });

  const patronTier = await prisma.membershipTier.upsert({
    where: { name: 'Patron Member' },
    update: {
      description: 'Top-tier membership with exclusive benefits',
      priceInr: 5000,
      durationMonths: null,
      benefits: [
        'All Gold benefits',
        'Donor recognition on wall',
        'Chapter voting rights',
        'Exclusive newsletters',
        'VIP event access',
        'Mentorship priority',
      ],
      badgeColor: '#8B5CF6',
      displayOrder: 4,
    },
    create: {
      name: 'Patron Member',
      description: 'Top-tier membership with exclusive benefits',
      priceInr: 5000,
      durationMonths: null, // Lifetime
      benefits: [
        'All Gold benefits',
        'Donor recognition on wall',
        'Chapter voting rights',
        'Exclusive newsletters',
        'VIP event access',
        'Mentorship priority',
      ],
      badgeColor: '#8B5CF6',
      displayOrder: 4,
    },
  });

  console.log('✅ Created membership tiers');

  // Create skills
  const skillNames = [
    'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python',
    'Java', 'C++', 'Machine Learning', 'Data Science', 'Cloud Computing',
    'AWS', 'Azure', 'Docker', 'Kubernetes', 'DevOps',
    'Project Management', 'Leadership', 'Communication', 'Problem Solving',
    'Agile', 'Scrum', 'UX Design', 'UI Design', 'Product Management',
    'Marketing', 'Sales', 'Finance', 'Consulting', 'Entrepreneurship',
  ];

  for (const name of skillNames) {
    await prisma.skill.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  console.log('✅ Created skills');

  // Create chapters
  const chapters = [
    { name: 'Mumbai Chapter', region: 'Mumbai, Maharashtra' },
    { name: 'Delhi NCR Chapter', region: 'Delhi, NCR' },
    { name: 'Bangalore Chapter', region: 'Bangalore, Karnataka' },
    { name: 'Pune Chapter', region: 'Pune, Maharashtra' },
    { name: 'Hyderabad Chapter', region: 'Hyderabad, Telangana' },
    { name: 'Chennai Chapter', region: 'Chennai, Tamil Nadu' },
    { name: 'North America Chapter', region: 'USA & Canada' },
    { name: 'Europe Chapter', region: 'UK, Germany & Europe' },
    { name: 'Gulf Chapter', region: 'UAE, Qatar & Middle East' },
  ];

  for (const chapter of chapters) {
    await prisma.chapter.upsert({
      where: { name: chapter.name },
      update: {
        region: chapter.region,
        isActive: true,
      },
      create: chapter,
    });
  }

  console.log('✅ Created chapters');

  // Create admin user. In production the password must come from the
  // environment; re-running the seed never resets an existing password.
  const isProduction = process.env.NODE_ENV === 'production';
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@aitdconnection.edu';
  const adminPlainPassword = process.env.SEED_ADMIN_PASSWORD || (isProduction ? '' : 'Admin@123');
  if (!adminPlainPassword || (isProduction && adminPlainPassword.length < 12)) {
    throw new Error('Set SEED_ADMIN_PASSWORD (12+ characters) to seed the super admin in production.');
  }
  const adminPassword = await bcrypt.hash(adminPlainPassword, 12);
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    // Re-seeding (SEED_ON_START) only re-asserts access; the admin's own profile edits are kept
    update: {
      userRole: 'SUPER_ADMIN',
      isVerified: true,
      isActive: true,
    },
    create: {
      email: adminEmail,
      passwordHash: adminPassword,
      fullName: 'System Administrator',
      batchYear: 2020,
      department: 'Administration',
      degree: 'B.Tech',
      roleType: 'ALUMNI',
      userRole: 'SUPER_ADMIN',
      isVerified: true,
      emailVerifiedAt: new Date(),
      profileCompleteness: 50,
      currentDesignation: 'Platform Administrator',
      shortBio: 'Managing the AITD Connection platform',
      membershipTierId: patronTier.id,
    },
  });

  console.log(`✅ Created admin user (${adminEmail}${process.env.SEED_ADMIN_PASSWORD ? '' : ' / Admin@123'})`);

  if (isProduction && process.env.SEED_SAMPLE_DATA !== 'true') {
    console.log('ℹ️  Skipping sample users/events/news in production (set SEED_SAMPLE_DATA=true to include).');
    return;
  }

  // Create sample users
  const samplePassword = await bcrypt.hash('User@123', 12);
  
  const departments = ['Computer Engineering', 'Electronics', 'Mechanical', 'Civil', 'IT'];
  // City centres; members are spread a few km around them, at the ~1 km precision the app stores
  const cityCoords: Record<string, [number, number]> = {
    Mumbai: [19.08, 72.88],
    Delhi: [28.61, 77.21],
    Bangalore: [12.97, 77.59],
    Pune: [18.52, 73.86],
    Hyderabad: [17.39, 78.49],
  };
  const cities = Object.keys(cityCoords);

  for (let i = 1; i <= 10; i++) {
    const dept = departments[i % departments.length];
    const city = cities[i % cities.length];
    const batchYear = 2015 + (i % 10);

    // Deterministic offsets (re-seeding gives the same map)
    const [cityLat, cityLng] = cityCoords[city];
    const lat = Math.round((cityLat + ((i % 3) - 1) * 0.03) * 100) / 100;
    const lng = Math.round((cityLng + ((i % 4) - 1.5) * 0.02) * 100) / 100;

    await prisma.user.upsert({
      where: { email: `user${i}@example.com` },
      update: {
        passwordHash: samplePassword,
        fullName: `Test User ${i}`,
        batchYear,
        department: dept,
        degree: 'B.Tech',
        roleType: 'ALUMNI',
        isVerified: true,
        isLocationPublic: true,
        locationLat: lat,
        locationLng: lng,
        emailVerifiedAt: new Date(),
        profileCompleteness: 60,
        currentDesignation: `Software Engineer ${i}`,
        shortBio: `Passionate alumnus from the ${batchYear} batch of ${dept}`,
        city,
        membershipTierId: generalTier.id,
      },
      create: {
        email: `user${i}@example.com`,
        passwordHash: samplePassword,
        fullName: `Test User ${i}`,
        batchYear,
        department: dept,
        degree: 'B.Tech',
        roleType: 'ALUMNI',
        isVerified: true,
        isLocationPublic: true,
        locationLat: lat,
        locationLng: lng,
        emailVerifiedAt: new Date(),
        profileCompleteness: 60,
        currentDesignation: `Software Engineer ${i}`,
        shortBio: `Passionate alumnus from the ${batchYear} batch of ${dept}`,
        city,
        membershipTierId: generalTier.id,
      },
    });
  }

  console.log('✅ Created 10 sample users');

  // Create sample events
  const eventData = [
    {
      title: 'Annual Alumni Reunion 2026',
      description: 'Join us for the biggest alumni gathering of the year! Network with fellow graduates, share your journey, and reconnect with old friends.',
      eventType: 'OFFLINE' as const,
      venue: 'College Auditorium',
      city: 'Mumbai',
      startDate: new Date('2026-05-15T10:00:00'),
      endDate: new Date('2026-05-15T18:00:00'),
      capacity: 500,
      tags: ['Reunion', 'Networking', 'Annual Event'],
      status: 'PUBLISHED' as const,
      createdById: adminUser.id,
    },
    {
      title: 'Tech Talk: AI in 2026',
      description: 'An insightful webinar on the latest developments in Artificial Intelligence and Machine Learning.',
      eventType: 'ONLINE' as const,
      joinLink: 'https://meet.google.com/abc-defg-hij',
      startDate: new Date('2026-04-20T15:00:00'),
      endDate: new Date('2026-04-20T16:30:00'),
      capacity: 200,
      tags: ['Tech', 'AI', 'Webinar'],
      status: 'PUBLISHED' as const,
      createdById: adminUser.id,
    },
    {
      title: 'Career Fair 2026',
      description: 'Connect with top companies hiring alumni. Bring your resume and get ready for opportunities!',
      eventType: 'HYBRID' as const,
      venue: 'College Campus',
      city: 'Pune',
      joinLink: 'https://meet.google.com/xyz-uvwx-rst',
      startDate: new Date('2026-06-10T09:00:00'),
      endDate: new Date('2026-06-10T17:00:00'),
      capacity: 300,
      tags: ['Career', 'Jobs', 'Networking'],
      status: 'PUBLISHED' as const,
      createdById: adminUser.id,
    },
  ];

  // Re-running the seed (e.g. SEED_ON_START in Docker) must not duplicate events
  for (const event of eventData) {
    const exists = await prisma.event.findFirst({ where: { title: event.title }, select: { id: true } });
    if (!exists) await prisma.event.create({ data: event });
  }

  console.log('✅ Created sample events');

  // Create sample news articles
  const newsData = [
    {
      title: 'AITD Connection Platform Launches',
      slug: 'alumni-connect-platform-launches',
      content: 'We are excited to announce the launch of our new AITD Connection platform...',
      excerpt: 'The new platform brings modern features for better networking.',
      category: 'INSTITUTE_UPDATE' as const,
      authorId: adminUser.id,
      status: 'PUBLISHED' as const,
      readingTime: 3,
      publishedAt: new Date(),
    },
    {
      title: 'Alumni Success Story: From Campus to Silicon Valley',
      slug: 'alumni-success-story-silicon-valley',
      content: 'Meet our distinguished alumnus who made it big in the tech industry...',
      excerpt: 'An inspiring journey from college to leading tech companies.',
      category: 'ALUMNI_STORY' as const,
      authorId: adminUser.id,
      status: 'PUBLISHED' as const,
      readingTime: 5,
      publishedAt: new Date(),
    },
  ];

  for (const article of newsData) {
    await prisma.newsArticle.upsert({
      where: { slug: article.slug },
      update: {
        title: article.title,
        content: article.content,
        excerpt: article.excerpt,
        category: article.category,
        authorId: article.authorId,
        status: article.status,
        readingTime: article.readingTime,
        publishedAt: article.publishedAt,
      },
      create: article,
    });
  }

  console.log('✅ Created sample news articles');

  await seedSocialGraph();

  console.log('🎉 Database seeding completed!');
}

/**
 * Sample social activity between the sample users: follows, posts with hashtags, reactions of
 * several types, a threaded conversation, a quote post and a plain repost. Idempotent: every row
 * is looked up before it is created, and counters are re-derived at the end.
 */
async function seedSocialGraph() {
  const users = await prisma.user.findMany({
    where: { email: { in: Array.from({ length: 6 }, (_, i) => `user${i + 1}@example.com`) } },
    orderBy: { email: 'asc' },
  });
  if (users.length < 6) return;
  const [u1, u2, u3, u4, u5, u6] = users;

  const follows: Array<[typeof u1, typeof u1]> = [[u1, u2], [u1, u3], [u2, u1], [u3, u1], [u4, u1], [u5, u2], [u6, u3]];
  for (const [follower, following] of follows) {
    await prisma.follow.upsert({
      where: { followerId_followingId: { followerId: follower.id, followingId: following.id } },
      update: {},
      create: { followerId: follower.id, followingId: following.id },
    });
  }

  const tagPattern = /(^|[^A-Za-z0-9_&#/])#([A-Za-z0-9_]{1,50})(?![A-Za-z0-9_])/g;
  const ensurePost = async (author: typeof u1, content: string, extra: Record<string, unknown> = {}) => {
    const existing = await prisma.post.findFirst({ where: { userId: author.id, content, ...extra } });
    if (existing) return existing;
    const created = await prisma.post.create({ data: { userId: author.id, content, ...extra } });
    const tags = [...new Set([...content.matchAll(tagPattern)].map((m) => m[2].toLowerCase()).filter((t) => /[a-z]/.test(t)))];
    for (const tag of tags) {
      const hashtag = await prisma.hashtag.upsert({ where: { tag }, update: {}, create: { tag } });
      await prisma.postHashtag.create({ data: { postId: created.id, hashtagId: hashtag.id, createdAt: created.createdAt } });
    }
    return created;
  };

  const placement = await ensurePost(u1, 'Our team at Acme is hiring two backend engineers this month. Referrals welcome! #hiring #placements');
  const reunion = await ensurePost(u2, 'Who is coming to the 10-year batch reunion in December? #reunion #alumni');
  const milestone = await ensurePost(u3, 'Just completed my first marathon. Thanks to everyone who trained with me! #milestone');
  const tips = await ensurePost(u4, 'Three things I wish I knew before my first job interview, thread below. #careers #placements');

  const reactions: Array<[typeof placement, typeof u1, 'LIKE' | 'CELEBRATE' | 'SUPPORT' | 'LOVE' | 'INSIGHTFUL' | 'FUNNY']> = [
    [placement, u2, 'SUPPORT'], [placement, u3, 'LIKE'], [placement, u5, 'INSIGHTFUL'],
    [reunion, u1, 'LOVE'], [reunion, u3, 'CELEBRATE'], [reunion, u4, 'LIKE'], [reunion, u6, 'FUNNY'],
    [milestone, u1, 'CELEBRATE'], [milestone, u2, 'CELEBRATE'], [milestone, u4, 'LOVE'],
    [tips, u5, 'INSIGHTFUL'], [tips, u6, 'INSIGHTFUL'],
  ];
  for (const [p, user, type] of reactions) {
    await prisma.postLike.upsert({
      where: { postId_userId: { postId: p.id, userId: user.id } },
      update: { type },
      create: { postId: p.id, userId: user.id, type },
    });
  }

  const ensureComment = async (p: typeof placement, author: typeof u1, content: string, parentId: string | null = null) =>
    (await prisma.postComment.findFirst({ where: { postId: p.id, userId: author.id, content } })) ??
    prisma.postComment.create({ data: { postId: p.id, userId: author.id, content, parentId } });

  const question = await ensureComment(reunion, u3, 'Count me in! Is there a venue yet?');
  await ensureComment(reunion, u2, 'Looking at the old auditorium, will confirm next week.', question.id);
  await ensureComment(reunion, u4, 'Happy to help organise.', question.id);
  await ensureComment(milestone, u1, 'Huge congratulations!');

  // Quote post and plain repost of the hiring post
  await ensurePost(u5, 'Great opportunity for our juniors, do apply.', { isRepost: true, repostOfId: placement.id });
  const plainKey = `${u6.id}:${placement.id}`;
  if (!(await prisma.post.findUnique({ where: { plainRepostKey: plainKey } }))) {
    await prisma.post.create({ data: { userId: u6.id, content: '', isRepost: true, repostOfId: placement.id, plainRepostKey: plainKey } });
  }

  for (const p of [placement, reunion, milestone, tips]) {
    const [likeCount, commentCount, repostCount] = await Promise.all([
      prisma.postLike.count({ where: { postId: p.id } }),
      prisma.postComment.count({ where: { postId: p.id } }),
      prisma.post.count({ where: { repostOfId: p.id, isRepost: true } }),
    ]);
    await prisma.post.update({ where: { id: p.id }, data: { likeCount, commentCount, repostCount } });
  }

  console.log('✅ Created sample social activity (follows, reactions, comments, reposts)');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
