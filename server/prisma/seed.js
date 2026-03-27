"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Seeding database...');
    // Create membership tiers
    const generalTier = await prisma.membershipTier.create({
        data: {
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
    const silverTier = await prisma.membershipTier.create({
        data: {
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
    const goldTier = await prisma.membershipTier.create({
        data: {
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
    const patronTier = await prisma.membershipTier.create({
        data: {
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
        await prisma.chapter.create({
            data: chapter,
        });
    }
    console.log('✅ Created chapters');
    // Create admin user
    const adminPassword = await bcryptjs_1.default.hash('Admin@123', 12);
    const adminUser = await prisma.user.create({
        data: {
            email: 'admin@alumniconnect.edu',
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
            shortBio: 'Managing the Alumni Connect platform',
            membershipTierId: patronTier.id,
        },
    });
    console.log('✅ Created admin user (admin@alumniconnect.edu / Admin@123)');
    // Create sample users
    const samplePassword = await bcryptjs_1.default.hash('User@123', 12);
    const departments = ['Computer Engineering', 'Electronics', 'Mechanical', 'Civil', 'IT'];
    const cities = ['Mumbai', 'Delhi', 'Bangalore', 'Pune', 'Hyderabad'];
    for (let i = 1; i <= 10; i++) {
        const dept = departments[i % departments.length];
        const city = cities[i % cities.length];
        const batchYear = 2015 + (i % 10);
        await prisma.user.create({
            data: {
                email: `user${i}@example.com`,
                passwordHash: samplePassword,
                fullName: `Test User ${i}`,
                batchYear,
                department: dept,
                degree: 'B.Tech',
                roleType: 'ALUMNI',
                isVerified: true,
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
            eventType: 'OFFLINE',
            venue: 'College Auditorium',
            city: 'Mumbai',
            startDate: new Date('2026-05-15T10:00:00'),
            endDate: new Date('2026-05-15T18:00:00'),
            capacity: 500,
            tags: ['Reunion', 'Networking', 'Annual Event'],
            status: 'PUBLISHED',
            createdById: adminUser.id,
        },
        {
            title: 'Tech Talk: AI in 2026',
            description: 'An insightful webinar on the latest developments in Artificial Intelligence and Machine Learning.',
            eventType: 'ONLINE',
            joinLink: 'https://meet.google.com/abc-defg-hij',
            startDate: new Date('2026-04-20T15:00:00'),
            endDate: new Date('2026-04-20T16:30:00'),
            capacity: 200,
            tags: ['Tech', 'AI', 'Webinar'],
            status: 'PUBLISHED',
            createdById: adminUser.id,
        },
        {
            title: 'Career Fair 2026',
            description: 'Connect with top companies hiring alumni. Bring your resume and get ready for opportunities!',
            eventType: 'HYBRID',
            venue: 'College Campus',
            city: 'Pune',
            joinLink: 'https://meet.google.com/xyz-uvwx-rst',
            startDate: new Date('2026-06-10T09:00:00'),
            endDate: new Date('2026-06-10T17:00:00'),
            capacity: 300,
            tags: ['Career', 'Jobs', 'Networking'],
            status: 'PUBLISHED',
            createdById: adminUser.id,
        },
    ];
    for (const event of eventData) {
        await prisma.event.create({ data: event });
    }
    console.log('✅ Created sample events');
    // Create sample news articles
    const newsData = [
        {
            title: 'Alumni Connect Platform Launches',
            slug: 'alumni-connect-platform-launches',
            content: 'We are excited to announce the launch of our new Alumni Connect platform...',
            excerpt: 'The new platform brings modern features for better networking.',
            category: 'INSTITUTE_UPDATE',
            authorId: adminUser.id,
            status: 'PUBLISHED',
            readingTime: 3,
            publishedAt: new Date(),
        },
        {
            title: 'Alumni Success Story: From Campus to Silicon Valley',
            slug: 'alumni-success-story-silicon-valley',
            content: 'Meet our distinguished alumnus who made it big in the tech industry...',
            excerpt: 'An inspiring journey from college to leading tech companies.',
            category: 'ALUMNI_STORY',
            authorId: adminUser.id,
            status: 'PUBLISHED',
            readingTime: 5,
            publishedAt: new Date(),
        },
    ];
    for (const article of newsData) {
        await prisma.newsArticle.create({ data: article });
    }
    console.log('✅ Created sample news articles');
    console.log('🎉 Database seeding completed!');
}
main()
    .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map