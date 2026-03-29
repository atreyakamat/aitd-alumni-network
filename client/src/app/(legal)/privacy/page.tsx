import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Alumni Connect',
  description: 'Privacy Policy for the AITD Alumni Connect platform',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <div className="container mx-auto px-6 max-w-4xl">
        <article className="bg-white rounded-2xl shadow-lg p-8 md:p-12">
          <header className="mb-12 text-center">
            <h1 className="font-headline text-4xl font-bold text-gray-900 mb-4">
              Privacy Policy
            </h1>
            <p className="text-gray-500">
              Last updated: March 2024
            </p>
          </header>

          <div className="prose prose-slate max-w-none prose-headings:font-headline prose-headings:text-[#002045] prose-a:text-amber-700 prose-a:no-underline hover:prose-a:underline">
            <section className="mb-8">
              <h2>1. Introduction</h2>
              <p>
                Welcome to Alumni Connect ("we," "our," or "us"). We are committed to protecting your 
                personal information and your right to privacy. This Privacy Policy explains how we 
                collect, use, disclose, and safeguard your information when you use our alumni networking 
                platform.
              </p>
              <p>
                Please read this privacy policy carefully. If you do not agree with the terms of this 
                privacy policy, please do not access the platform.
              </p>
            </section>

            <section className="mb-8">
              <h2>2. Information We Collect</h2>
              
              <h3>2.1 Personal Information You Provide</h3>
              <p>We collect information that you voluntarily provide to us when you:</p>
              <ul>
                <li>Register for an account</li>
                <li>Complete your profile</li>
                <li>Post content or participate in discussions</li>
                <li>Send messages to other members</li>
                <li>Make donations or purchase memberships</li>
                <li>Contact us with inquiries</li>
              </ul>
              
              <p>This information may include:</p>
              <ul>
                <li><strong>Identity Data:</strong> Name, graduation year, department, enrollment number</li>
                <li><strong>Contact Data:</strong> Email address, phone number, physical address</li>
                <li><strong>Profile Data:</strong> Biography, professional experience, skills, interests</li>
                <li><strong>Financial Data:</strong> Payment card details (processed securely via Razorpay)</li>
                <li><strong>Usage Data:</strong> Information about how you use our platform</li>
                <li><strong>Marketing Data:</strong> Your preferences for receiving communications from us</li>
              </ul>

              <h3>2.2 Information Automatically Collected</h3>
              <p>When you access our platform, we automatically collect certain information, including:</p>
              <ul>
                <li>Device information (browser type, operating system)</li>
                <li>IP address and location data</li>
                <li>Pages visited and actions taken</li>
                <li>Time and date of visits</li>
                <li>Referring website or application</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2>3. How We Use Your Information</h2>
              <p>We use the information we collect to:</p>
              <ul>
                <li>Create and manage your account</li>
                <li>Enable alumni networking and connection features</li>
                <li>Process donations and membership payments</li>
                <li>Send administrative information and updates</li>
                <li>Personalize your experience on the platform</li>
                <li>Respond to your inquiries and provide customer support</li>
                <li>Analyze usage patterns to improve our services</li>
                <li>Protect against fraudulent or illegal activity</li>
                <li>Comply with legal obligations</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2>4. Sharing Your Information</h2>
              <p>We may share your information in the following circumstances:</p>
              
              <h3>4.1 With Other Alumni</h3>
              <p>
                Information in your public profile (name, graduation year, profession) is visible to 
                other verified alumni. You control what information appears on your profile through 
                your privacy settings.
              </p>

              <h3>4.2 Service Providers</h3>
              <p>
                We may share your information with third-party service providers who perform services 
                on our behalf, such as payment processing (Razorpay), email delivery, and hosting services.
              </p>

              <h3>4.3 Legal Requirements</h3>
              <p>
                We may disclose your information if required to do so by law or in response to valid 
                requests by public authorities.
              </p>

              <h3>4.4 Business Transfers</h3>
              <p>
                If we are involved in a merger, acquisition, or sale of assets, your information may 
                be transferred as part of that transaction.
              </p>
            </section>

            <section className="mb-8">
              <h2>5. Data Security</h2>
              <p>
                We implement appropriate technical and organizational security measures to protect 
                your personal information, including:
              </p>
              <ul>
                <li>Encryption of data in transit (SSL/TLS) and at rest</li>
                <li>Secure authentication mechanisms</li>
                <li>Regular security assessments and updates</li>
                <li>Access controls limiting who can access your data</li>
                <li>Employee training on data protection</li>
              </ul>
              <p>
                However, no method of transmission over the Internet or electronic storage is 100% 
                secure. While we strive to protect your personal information, we cannot guarantee 
                its absolute security.
              </p>
            </section>

            <section className="mb-8">
              <h2>6. Your Privacy Rights</h2>
              <p>You have the following rights regarding your personal information:</p>
              <ul>
                <li><strong>Access:</strong> Request a copy of the personal data we hold about you</li>
                <li><strong>Rectification:</strong> Request correction of inaccurate data</li>
                <li><strong>Erasure:</strong> Request deletion of your personal data</li>
                <li><strong>Data Portability:</strong> Request a copy of your data in a machine-readable format</li>
                <li><strong>Objection:</strong> Object to certain processing of your data</li>
                <li><strong>Withdraw Consent:</strong> Withdraw consent where processing is based on consent</li>
              </ul>
              <p>
                To exercise any of these rights, please contact us at privacy@alumniconnect.aitd.edu 
                or through your account settings.
              </p>
            </section>

            <section className="mb-8">
              <h2>7. Data Retention</h2>
              <p>
                We retain your personal information for as long as your account is active or as needed 
                to provide you services. We may also retain and use your information as necessary to:
              </p>
              <ul>
                <li>Comply with legal obligations</li>
                <li>Resolve disputes</li>
                <li>Enforce our agreements</li>
                <li>Maintain security and prevent fraud</li>
              </ul>
              <p>
                You may request deletion of your account at any time. Upon deletion, we will remove 
                your personal information within 30 days, except where retention is required by law.
              </p>
            </section>

            <section className="mb-8">
              <h2>8. Cookies and Tracking</h2>
              <p>
                We use cookies and similar tracking technologies to collect and store information 
                about your preferences and activity on our platform. You can control cookies through 
                your browser settings.
              </p>
              <p>Types of cookies we use:</p>
              <ul>
                <li><strong>Essential Cookies:</strong> Required for the platform to function</li>
                <li><strong>Preference Cookies:</strong> Remember your settings and preferences</li>
                <li><strong>Analytics Cookies:</strong> Help us understand how you use the platform</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2>9. Third-Party Links</h2>
              <p>
                Our platform may contain links to third-party websites or services. We are not 
                responsible for the privacy practices of these third parties. We encourage you to 
                read the privacy policies of any third-party sites you visit.
              </p>
            </section>

            <section className="mb-8">
              <h2>10. Children's Privacy</h2>
              <p>
                Our platform is not intended for children under 18 years of age. We do not knowingly 
                collect personal information from children under 18. If you are a parent or guardian 
                and believe your child has provided us with personal information, please contact us.
              </p>
            </section>

            <section className="mb-8">
              <h2>11. Changes to This Policy</h2>
              <p>
                We may update this privacy policy from time to time. We will notify you of any changes 
                by posting the new privacy policy on this page and updating the "Last updated" date. 
                We encourage you to review this policy periodically.
              </p>
            </section>

            <section className="mb-8">
              <h2>12. Contact Us</h2>
              <p>
                If you have any questions about this Privacy Policy or our data practices, please 
                contact us:
              </p>
              <ul>
                <li><strong>Email:</strong> privacy@alumniconnect.aitd.edu</li>
                <li><strong>Address:</strong> AITD Alumni Association, [College Address]</li>
                <li><strong>Phone:</strong> +91-XXXX-XXXXXX</li>
              </ul>
            </section>
          </div>
        </article>
      </div>
    </div>
  );
}
