export default function CookiePolicyPage() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="font-headline text-4xl font-bold mb-8">Cookie Policy</h1>
      <p className="text-muted-foreground mb-8">Last updated: March 2024</p>

      <div className="prose prose-slate max-w-none space-y-8">
        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">1. What Are Cookies?</h2>
          <p className="text-muted-foreground leading-relaxed">
            Cookies are small text files that are placed on your computer or mobile device when you visit a website. They are widely used to make websites work more efficiently and provide information to the owners of the site.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">2. How We Use Cookies</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            Alumni Connect uses cookies and similar technologies for various purposes:
          </p>
          
          <h3 className="font-headline text-xl font-medium mb-3">Essential Cookies</h3>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground mb-4">
            <li>Authentication and session management</li>
            <li>Security features (CSRF protection)</li>
            <li>User preferences and settings</li>
            <li>Load balancing for site performance</li>
          </ul>

          <h3 className="font-headline text-xl font-medium mb-3">Functional Cookies</h3>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground mb-4">
            <li>Remembering your login status</li>
            <li>Language and region preferences</li>
            <li>Personalized content settings</li>
            <li>Form auto-fill functionality</li>
          </ul>

          <h3 className="font-headline text-xl font-medium mb-3">Analytics Cookies</h3>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground mb-4">
            <li>Understanding how visitors use our platform</li>
            <li>Measuring platform performance</li>
            <li>Identifying popular features and content</li>
            <li>Improving user experience</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">3. Types of Cookies We Use</h2>
          
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-border">
              <thead className="bg-muted">
                <tr>
                  <th className="border border-border px-4 py-2 text-left">Cookie Name</th>
                  <th className="border border-border px-4 py-2 text-left">Purpose</th>
                  <th className="border border-border px-4 py-2 text-left">Duration</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr>
                  <td className="border border-border px-4 py-2">access_token</td>
                  <td className="border border-border px-4 py-2">Authentication</td>
                  <td className="border border-border px-4 py-2">15 minutes</td>
                </tr>
                <tr className="bg-muted/50">
                  <td className="border border-border px-4 py-2">refresh_token</td>
                  <td className="border border-border px-4 py-2">Session refresh</td>
                  <td className="border border-border px-4 py-2">7 days</td>
                </tr>
                <tr>
                  <td className="border border-border px-4 py-2">theme</td>
                  <td className="border border-border px-4 py-2">Display preferences</td>
                  <td className="border border-border px-4 py-2">1 year</td>
                </tr>
                <tr className="bg-muted/50">
                  <td className="border border-border px-4 py-2">consent</td>
                  <td className="border border-border px-4 py-2">Cookie consent status</td>
                  <td className="border border-border px-4 py-2">1 year</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">4. Third-Party Cookies</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We may use third-party services that set their own cookies:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li><strong>Google Analytics:</strong> For understanding site usage patterns</li>
            <li><strong>Google Maps:</strong> For the Alumni Nearby feature</li>
            <li><strong>Razorpay:</strong> For payment processing</li>
            <li><strong>Social Media:</strong> For login and sharing features</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">5. Managing Cookies</h2>
          <p className="text-muted-foreground leading-relaxed mb-4">
            You can control and manage cookies in several ways:
          </p>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground mb-4">
            <li>Browser settings to block or delete cookies</li>
            <li>Using &quot;incognito&quot; or &quot;private browsing&quot; mode</li>
            <li>Our cookie consent banner when you first visit</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Please note that disabling certain cookies may affect the functionality of Alumni Connect and your user experience.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">6. Browser-Specific Instructions</h2>
          <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
            <li><strong>Chrome:</strong> Settings → Privacy and Security → Cookies</li>
            <li><strong>Firefox:</strong> Settings → Privacy & Security → Cookies</li>
            <li><strong>Safari:</strong> Preferences → Privacy → Cookies</li>
            <li><strong>Edge:</strong> Settings → Cookies and Site Permissions</li>
          </ul>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">7. Updates to This Policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this Cookie Policy from time to time to reflect changes in our practices or for other operational, legal, or regulatory reasons. We will notify you of any material changes by posting the new policy on this page with a new &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="font-headline text-2xl font-semibold mb-4">8. Contact Us</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have any questions about our use of cookies, please contact us at:
          </p>
          <div className="bg-muted p-4 rounded-lg mt-4">
            <p className="text-muted-foreground">
              <strong>Email:</strong> privacy@alumniconnect.edu<br />
              <strong>Address:</strong> Alumni Office, Engineering College Campus<br />
              <strong>Phone:</strong> +91-XX-XXXX-XXXX
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
