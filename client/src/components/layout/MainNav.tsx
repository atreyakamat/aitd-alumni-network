'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  GraduationCap,
  Home,
  Users,
  Briefcase,
  CalendarDays,
  MessageSquare,
  Settings,
  LogOut,
  User,
  UserPen,
  Menu,
  X,
  Image,
  Newspaper,
  Heart,
  MapPin,
  Store,
  Search,
  Shield,
  UserCog,
  ClipboardCheck,
  ScrollText,
  Clapperboard,
  Bookmark,
  Flag,
} from 'lucide-react';
import { getInitials } from '@/lib/utils';
import { isAdmin as hasAdminRole } from '@/lib/roles';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { useState } from 'react';

const navItems = [
  { href: '/dashboard', label: 'Home', icon: Home },
  { href: '/reels', label: 'Reels', icon: Clapperboard },
  { href: '/network', label: 'Network', icon: Users },
  { href: '/jobs', label: 'Jobs', icon: Briefcase },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
];

const moreItems = [
  { href: '/saved', label: 'Saved posts', icon: Bookmark },
  { href: '/directory', label: 'Directory', icon: Users },
  { href: '/yearbook', label: 'Yearbook', icon: GraduationCap },
  { href: '/gallery', label: 'Gallery', icon: Image },
  { href: '/news', label: 'News', icon: Newspaper },
  { href: '/donations', label: 'Donate', icon: Heart },
  { href: '/chapters', label: 'Chapters', icon: MapPin },
  { href: '/marketplace', label: 'Marketplace', icon: Store },
];

/** Only rendered for ADMIN / SUPER_ADMIN (UX gate; the API enforces). */
export const adminItems = [
  { href: '/admin', label: 'Admin', icon: Shield },
  { href: '/admin/users', label: 'Manage Users', icon: UserCog },
  { href: '/admin/moderation', label: 'Moderation', icon: ClipboardCheck },
  { href: '/admin/reports', label: 'Reported content', icon: Flag },
  { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
];

export function MainNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isAdmin = hasAdminRole(user);

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="bg-primary rounded-lg p-1.5">
            <GraduationCap className="h-5 w-5 text-white" />
          </div>
          <span className="text-xl font-bold text-primary hidden sm:inline">AITD Connection</span>
        </Link>

        {/* Search Bar */}
        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <form 
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const q = formData.get('q');
              if (q) router.push(`/search?q=${encodeURIComponent(q as string)}`);
            }}
            className="relative w-full"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              name="q"
              type="text"
              placeholder="Search alumni, jobs, events..."
              className="w-full h-10 pl-10 pr-4 rounded-full bg-secondary border-0 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </form>
        </div>

        {/* Desktop Nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <Button
                variant="ghost"
                className={cn(
                  'flex flex-col items-center gap-1 h-14 px-4',
                  pathname === item.href && 'text-primary border-b-2 border-primary rounded-none'
                )}
              >
                <item.icon className="h-5 w-5" />
                <span className="text-xs">{item.label}</span>
              </Button>
            </Link>
          ))}

          {isAdmin && (
            <Link href="/admin">
              <Button
                variant="ghost"
                className={cn(
                  'flex flex-col items-center gap-1 h-14 px-4',
                  pathname?.startsWith('/admin') && 'text-primary border-b-2 border-primary rounded-none'
                )}
              >
                <Shield className="h-5 w-5" />
                <span className="text-xs">Admin</span>
              </Button>
            </Link>
          )}

          {/* More dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex flex-col items-center gap-1 h-14 px-4">
                <Menu className="h-5 w-5" />
                <span className="text-xs">More</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {moreItems.map((item) => (
                <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                  <item.icon className="mr-2 h-4 w-4" />
                  {item.label}
                </DropdownMenuItem>
              ))}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs text-muted-foreground">Administration</DropdownMenuLabel>
                  {adminItems.slice(1).map((item) => (
                    <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>
                      <item.icon className="mr-2 h-4 w-4" />
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Notifications */}
          <NotificationBell />

          {/* User Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-10 w-10 rounded-full" aria-label="Open user menu">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={user?.avatarUrl} alt={user?.fullName} />
                  <AvatarFallback>{user?.fullName ? getInitials(user.fullName) : 'U'}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end">
              <DropdownMenuLabel>
                <div className="flex flex-col">
                  <p className="font-medium">{user?.fullName}</p>
                  <p className="text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push(`/profile/${user?.id}`)}>
                <User className="mr-2 h-4 w-4" />
                My Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/profile/edit')}>
                <UserPen className="mr-2 h-4 w-4" />
                Edit profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                <Settings className="mr-2 h-4 w-4" />
                Account settings
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onClick={() => router.push('/admin')}>
                  <Shield className="mr-2 h-4 w-4" />
                  Admin dashboard
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="text-destructive">
                <LogOut className="mr-2 h-4 w-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Mobile menu toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Nav */}
      {mobileMenuOpen && (
        <nav className="lg:hidden border-t bg-background p-4">
          <div className="grid grid-cols-4 gap-2">
            {[...navItems, ...moreItems, ...(isAdmin ? adminItems : [])].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  'flex flex-col items-center gap-1 p-2 rounded-lg text-xs',
                  pathname === item.href ? 'bg-primary/10 text-primary' : 'text-muted-foreground'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
