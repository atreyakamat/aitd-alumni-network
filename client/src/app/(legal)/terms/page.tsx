import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | AITD Connection',
  description: 'Terms of Service for the AITD AITD Connection platform',
};

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <div className="container mx-auto px-6 max-w-4xl">
        <article className="bg-white rounded-2xl shadow-lg p-8 md:p-12">
          <header className="mb-12 text-center">
            <h1 className="font-headline text-4xl font-bold text-gray-900 mb-4">
              Terms of Service
            </h1>
            <p className="text-gray-500">
              Last updated: March 2024
            </p>
          </header>

          <div className="prose prose-slate max-w-none prose-headings:font-headline prose-headings:text-[#002045] prose-a:text-amber-700 prose-a:no-underline hover:prose-a:underline">
            <section className="mb-8">
              <h2>1. Agreement to Terms</h2>
              <p>
                By accessing or using the AITD Connection platform ("Platform"), you agree to be bound 
                by these Terms of Service ("Terms"). If you do not agree to these Terms, please do not 
                use the Platform.
              </p>
              <p>
                These Terms constitute a legally binding agreement between you and the AITD Alumni 
                Association ("we," "our," or "us") governing your use of the Platform.
              </p>
            </section>

            <section className="mb-8">
              <h2>2. Eligibility</h2>
              <p>To use our Platform, you must:</p>
              <ul>
                <li>Be at least 18 years old</li>
                <li>Be a graduate, former student, or faculty member of AITD, or have an affiliation approved by the administration</li>
                <li>Provide accurate and complete registration information</li>
                <li>Not have been previously suspended or removed from the Platform</li>
              </ul>
              <p>
                We reserve the right to verify your eligibility and may request documentation to 
                confirm your status as an alumnus or affiliated member.
              </p>
            </section>

            <section className="mb-8">
              <h2>3. Account Registration</h2>
              <h3>3.1 Account Creation</h3>
              <p>
                To access certain features of the Platform, you must create an account. You agree to:
              </p>
              <ul>
                <li>Provide accurate, current, and complete information</li>
                <li>Maintain and promptly update your account information</li>
                <li>Keep your password secure and confidential</li>
                <li>Not share your account credentials with others</li>
                <li>Notify us immediately of any unauthorized use of your account</li>
              </ul>

              <h3>3.2 Account Verification</h3>
              <p>
                Your account may require verification by our administrative team. We may approve, 
                reject, or request additional information for verification. This process typically 
                takes 2-3 business days.
              </p>
            </section>

            <section className="mb-8">
              <h2>4. Acceptable Use</h2>
              <h3>4.1 Permitted Uses</h3>
              <p>You may use the Platform to:</p>
              <ul>
                <li>Connect with fellow alumni</li>
                <li>Share professional and personal updates</li>
                <li>Access job postings and career resources</li>
                <li>Register for events and reunions</li>
                <li>Make donations to support the institution</li>
                <li>Participate in mentorship programs</li>
              </ul>

              <h3>4.2 Prohibited Conduct</h3>
              <p>You agree NOT to:</p>
              <ul>
                <li>Post false, misleading, or inaccurate information</li>
                <li>Impersonate another person or entity</li>
                <li>Harass, bully, or intimidate other users</li>
                <li>Post spam, advertisements, or unsolicited commercial content</li>
                <li>Share content that is illegal, obscene, or offensive</li>
                <li>Attempt to gain unauthorized access to other accounts or systems</li>
                <li>Scrape, data mine, or collect information from the Platform without permission</li>
                <li>Use the Platform for any illegal purpose</li>
                <li>Interfere with the proper functioning of the Platform</li>
                <li>Distribute malware or harmful code</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2>5. User Content</h2>
              <h3>5.1 Your Content</h3>
              <p>
                You retain ownership of content you post on the Platform ("User Content"). By posting 
                User Content, you grant us a non-exclusive, worldwide, royalty-free license to use, 
                display, and distribute your content in connection with operating the Platform.
              </p>

              <h3>5.2 Content Standards</h3>
              <p>All User Content must:</p>
              <ul>
                <li>Be accurate and not misleading</li>
                <li>Not infringe on intellectual property rights of others</li>
                <li>Not contain personal information of others without consent</li>
                <li>Comply with applicable laws and regulations</li>
              </ul>

              <h3>5.3 Content Moderation</h3>
              <p>
                We reserve the right to review, edit, or remove any User Content that violates these 
                Terms or our Community Guidelines. We may also suspend or terminate accounts that 
                repeatedly violate our policies.
              </p>
            </section>

            <section className="mb-8">
              <h2>6. Memberships and Payments</h2>
              <h3>6.1 Membership Tiers</h3>
              <p>
                We offer various membership tiers with different benefits. Details of each tier and 
                associated fees are available on the Platform. Membership fees are non-refundable 
                unless otherwise stated.
              </p>

              <h3>6.2 Payment Processing</h3>
              <p>
                Payments are processed securely through Razorpay. By making a payment, you agree to 
                Razorpay's terms of service. We do not store your complete payment card information 
                on our servers.
              </p>

              <h3>6.3 Automatic Renewal</h3>
              <p>
                Memberships may automatically renew unless you cancel before the renewal date. You 
                can manage your subscription settings in your account.
              </p>
            </section>

            <section className="mb-8">
              <h2>7. Donations</h2>
              <p>
                Donations made through the Platform are voluntary contributions to support the AITD 
                Alumni Association and its initiatives. Donations may be tax-deductible under Section 
                80G of the Income Tax Act, subject to applicable regulations.
              </p>
              <p>
                Donation receipts will be provided for all contributions. Refunds of donations are 
                generally not provided except in cases of duplicate charges or technical errors.
              </p>
            </section>

            <section className="mb-8">
              <h2>8. Intellectual Property</h2>
              <h3>8.1 Platform Content</h3>
              <p>
                The Platform and its original content, features, and functionality are owned by the 
                AITD Alumni Association and are protected by copyright, trademark, and other 
                intellectual property laws.
              </p>

              <h3>8.2 Trademarks</h3>
              <p>
                "AITD Connection," "AITD," and related logos are trademarks of the AITD Alumni 
                Association. You may not use these trademarks without our prior written consent.
              </p>
            </section>

            <section className="mb-8">
              <h2>9. Privacy</h2>
              <p>
                Your use of the Platform is also governed by our Privacy Policy, which describes how 
                we collect, use, and protect your personal information. By using the Platform, you 
                consent to our data practices as described in the Privacy Policy.
              </p>
            </section>

            <section className="mb-8">
              <h2>10. Disclaimers</h2>
              <h3>10.1 Platform Availability</h3>
              <p>
                We strive to maintain Platform availability but do not guarantee uninterrupted access. 
                The Platform is provided "as is" and "as available" without warranties of any kind.
              </p>

              <h3>10.2 Third-Party Content</h3>
              <p>
                The Platform may contain links to third-party websites or content posted by other 
                users. We are not responsible for the accuracy, legality, or appropriateness of 
                such third-party content.
              </p>

              <h3>10.3 Job Listings</h3>
              <p>
                Job listings on the Platform are posted by employers or recruiters. We do not 
                guarantee the accuracy of job information or the outcome of any job application.
              </p>
            </section>

            <section className="mb-8">
              <h2>11. Limitation of Liability</h2>
              <p>
                To the maximum extent permitted by law, the AITD Alumni Association and its officers, 
                directors, employees, and agents shall not be liable for any indirect, incidental, 
                special, consequential, or punitive damages arising from your use of the Platform.
              </p>
              <p>
                Our total liability for any claims arising from these Terms or your use of the 
                Platform shall not exceed the amount you paid to us in the twelve months preceding 
                the claim.
              </p>
            </section>

            <section className="mb-8">
              <h2>12. Indemnification</h2>
              <p>
                You agree to indemnify and hold harmless the AITD Alumni Association and its officers, 
                directors, employees, and agents from any claims, damages, losses, or expenses 
                (including legal fees) arising from:
              </p>
              <ul>
                <li>Your use of the Platform</li>
                <li>Your violation of these Terms</li>
                <li>Your User Content</li>
                <li>Your violation of any rights of another</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2>13. Termination</h2>
              <h3>13.1 By You</h3>
              <p>
                You may terminate your account at any time by contacting us or using the account 
                deletion feature in your settings. Active memberships will remain valid until the 
                end of the billing period.
              </p>

              <h3>13.2 By Us</h3>
              <p>
                We may suspend or terminate your account if you violate these Terms, engage in 
                prohibited conduct, or for any other reason at our discretion. We will provide 
                notice where reasonably possible.
              </p>
            </section>

            <section className="mb-8">
              <h2>14. Dispute Resolution</h2>
              <p>
                Any disputes arising from these Terms or your use of the Platform shall be resolved 
                through:
              </p>
              <ol>
                <li><strong>Informal Resolution:</strong> Contact us first to attempt to resolve the dispute informally</li>
                <li><strong>Mediation:</strong> If informal resolution fails, either party may request mediation</li>
                <li><strong>Arbitration:</strong> Binding arbitration under the Arbitration and Conciliation Act, 1996</li>
              </ol>
              <p>
                These Terms shall be governed by the laws of India, without regard to conflict of 
                law principles.
              </p>
            </section>

            <section className="mb-8">
              <h2>15. Changes to Terms</h2>
              <p>
                We may update these Terms from time to time. We will notify you of material changes 
                by posting a notice on the Platform or sending you an email. Your continued use of 
                the Platform after changes take effect constitutes acceptance of the updated Terms.
              </p>
            </section>

            <section className="mb-8">
              <h2>16. General Provisions</h2>
              <ul>
                <li><strong>Entire Agreement:</strong> These Terms constitute the entire agreement between you and us regarding the Platform.</li>
                <li><strong>Severability:</strong> If any provision is found unenforceable, the remaining provisions remain in effect.</li>
                <li><strong>Waiver:</strong> Our failure to enforce any right does not waive that right.</li>
                <li><strong>Assignment:</strong> You may not assign these Terms. We may assign our rights and obligations.</li>
              </ul>
            </section>

            <section className="mb-8">
              <h2>17. Contact Us</h2>
              <p>
                If you have questions about these Terms, please contact us:
              </p>
              <ul>
                <li><strong>Email:</strong> legal@aitdconnection.aitd.edu</li>
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
