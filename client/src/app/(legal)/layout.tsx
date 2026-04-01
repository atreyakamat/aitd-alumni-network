import Link from 'next/link';

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-xl font-bold text-[#002045]">
              AITD Connection
            </Link>
            <nav className="flex items-center gap-6">
              <Link
                href="/privacy"
                className="text-gray-600 hover:text-[#002045] transition-colors"
              >
                Privacy Policy
              </Link>
              <Link
                href="/terms"
                className="text-gray-600 hover:text-[#002045] transition-colors"
              >
                Terms of Service
              </Link>
              <Link
                href="/"
                className="bg-[#002045] text-white px-4 py-2 rounded-lg hover:bg-[#003366] transition-colors"
              >
                Back to Home
              </Link>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">{children}</main>

      {/* Footer */}
      <footer className="bg-gray-100 py-8">
        <div className="container mx-auto px-6 text-center text-gray-600">
          <p>&copy; {new Date().getFullYear()} AITD Alumni Association. All rights reserved.</p>
          <div className="mt-4 flex justify-center gap-6 text-sm">
            <Link href="/privacy" className="hover:text-[#002045]">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-[#002045]">
              Terms of Service
            </Link>
            <a href="mailto:contact@aitdconnection.aitd.edu" className="hover:text-[#002045]">
              Contact Us
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
