import { Bell, ClipboardList, LayoutDashboard, LogIn, LogOut, Menu, MessageCircle, MessageSquare, Moon, PanelLeft, Radar, Settings, ShieldCheck, Star, Sun, Target, User, Wallet, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { GlobalAiAssistant } from '../components/assistant/GlobalAiAssistant';
import { useAuth } from '../contexts/AuthContext';

const navItems = [
  { path: '/dashboard', label: 'Overview', icon: <LayoutDashboard size={19} />, group: 'overview' },
  { path: '/watchlist', label: 'Watchlist', icon: <Star size={19} />, group: 'overview' },
  { path: '/detection', label: 'Detection Engine', icon: <Radar size={19} />, group: 'market' },
  { path: '/sentiment', label: 'Narrative Intelligence', icon: <Target size={19} />, group: 'market' },
  { path: '/smart-money', label: 'Smart Money', icon: <Zap size={19} />, group: 'capital' },
  { path: '/wallet', label: 'Wallet Intelligence', icon: <Wallet size={19} />, group: 'capital' },
  { path: '/smart-alerts', label: 'Intelligence Monitor', icon: <Bell size={19} />, group: 'tools' },
  { path: '/ai-assistant', label: 'AI Market Analyst', icon: <MessageSquare size={19} />, group: 'tools' },
  { path: '/safe-scan', label: 'Safe Scan', icon: <ShieldCheck size={19} />, group: 'tools' },
  { path: '/settings', label: 'Settings', icon: <Settings size={19} />, group: 'account' },
  { path: '/feedback', label: 'Feedback', icon: <MessageCircle size={19} />, group: 'account' },
  { path: '/admin', label: 'Admin', icon: <ClipboardList size={19} />, group: 'account', adminOnly: true }
] as const;

const sections = [
  { key: 'overview', label: 'Overview' },
  { key: 'market', label: 'Market & Narrative Intelligence' },
  { key: 'capital', label: 'Wallet & Capital Intelligence' },
  { key: 'tools', label: 'Platform-wide Intelligence & Tools' },
  { key: 'account', label: 'Account' }
] as const;

function titleFromPath(pathname: string) {
  if (pathname === '/' || pathname.startsWith('/dashboard')) return 'Overview';
  if (pathname.startsWith('/coin')) return 'Coin Details';
  if (pathname.startsWith('/token')) return 'Token Details';
  if (pathname.startsWith('/safe-scan')) return 'Safe Scan';
  if (pathname.startsWith('/detection')) return 'Detection Engine';
  if (pathname.startsWith('/sentiment')) return 'Narrative Intelligence';
  if (pathname.startsWith('/smart-money')) return 'Smart Money';
  if (pathname.startsWith('/wallet')) return 'Wallet Intelligence';
  if (pathname.startsWith('/smart-alerts')) return 'Intelligence Monitor';
  if (pathname.startsWith('/watchlist')) return 'Watchlist';
  if (pathname.startsWith('/ai-assistant')) return 'AI Market Analyst';
  if (pathname.startsWith('/feedback')) return 'Feedback';
  if (pathname.startsWith('/admin')) return 'Admin';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'Page not found';
}

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, profile, loading: authLoading, signOut } = useAuth();
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('atlaix-theme-preview') === 'dark';
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [navPinned, setNavPinned] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const pageTitle = titleFromPath(location.pathname);
  const showGlobalAiAssistant = !location.pathname.startsWith('/feedback');
  const displayName = profile?.display_name || user?.email?.split('@')[0] || 'Guest';
  const displayEmail = user?.email || 'Not signed in';
  const initial = displayName.trim().charAt(0).toUpperCase() || 'A';

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
      document.documentElement.dataset.atlaixTheme = darkMode ? 'dark' : 'light';
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('atlaix-theme-preview', darkMode ? 'dark' : 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handleClick = (event: MouseEvent) => {
      if (!userMenuRef.current?.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [userMenuOpen]);

  const handleLogin = () => {
    setUserMenuOpen(false);
    navigate('/login');
  };

  const handleLogout = async () => {
    setUserMenuOpen(false);
    await signOut();
    navigate('/dashboard', { replace: true });
  };

  return (
    <div className={`app-shell ${darkMode ? 'dark-preview' : ''}`}>
      <header className="topbar">
        <button className="icon-button mobile-only" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
          <Menu size={21} />
        </button>
        <Link className="brand-mark desktop-only" to="/dashboard" aria-label="Atlaix overview">
          <span><img src="/logo.png" alt="" /></span>
          <strong>Atlaix</strong>
        </Link>
        <h1>{pageTitle}</h1>
        <div className="topbar-actions">
          <div className="theme-segment" role="group" aria-label="Choose appearance">
            <button className={!darkMode ? 'active' : ''} type="button" onClick={() => setDarkMode(false)} aria-label="Switch to light mode" aria-pressed={!darkMode} title="Light mode">
              <Sun size={17} />
            </button>
            <button className={darkMode ? 'active' : ''} type="button" onClick={() => setDarkMode(true)} aria-label="Switch to dark mode" aria-pressed={darkMode} title="Dark mode">
              <Moon size={17} />
            </button>
          </div>
          <div className="profile-menu" ref={userMenuRef}>
            <button className="profile-button" type="button" onClick={() => setUserMenuOpen((current) => !current)} aria-label="Open user menu" aria-expanded={userMenuOpen}>
              {user ? <span>{initial}</span> : <User size={18} />}
            </button>
            {userMenuOpen && (
              <div className="profile-popover">
                <div>
                  <strong>{authLoading ? 'Loading...' : displayName}</strong>
                  <small>{displayEmail}</small>
                </div>
                {user ? (
                  <>
                    <Link to="/settings" onClick={() => setUserMenuOpen(false)}>
                      <Settings size={16} />
                      <span>Settings</span>
                    </Link>
                    {profile?.role === 'admin' ? (
                      <Link to="/admin" onClick={() => setUserMenuOpen(false)}>
                        <ClipboardList size={16} />
                        <span>Admin</span>
                      </Link>
                    ) : null}
                    <button type="button" onClick={handleLogout}>
                      <LogOut size={16} />
                      <span>Log out</span>
                    </button>
                  </>
                ) : (
                  <button type="button" onClick={handleLogin}>
                    <LogIn size={16} />
                    <span>Log in</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {mobileNavOpen ? (
        <div className="mobile-nav" role="dialog" aria-modal="true" aria-label="Navigation">
          <button className="mobile-nav-scrim" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation" />
          <aside>
            <div className="mobile-nav-head">
              <Link to="/dashboard" onClick={() => setMobileNavOpen(false)}><span><img src="/logo.png" alt="" /></span><strong>Atlaix</strong></Link>
              <button type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={21} /></button>
            </div>
            <NavList closeMobile={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      ) : null}

      <aside className={`rail ${navPinned ? 'pinned' : ''}`}>
        <button className="rail-pin" type="button" onClick={() => setNavPinned((current) => !current)} aria-label={navPinned ? 'Collapse navigation' : 'Keep navigation open'}>
          <PanelLeft size={20} />
        </button>
        <NavList />
        <button className="rail-account" type="button" onClick={user ? handleLogout : handleLogin} aria-label={user ? 'Log out' : 'Log in'}>
          {user ? <LogOut size={18} /> : <LogIn size={18} />}
          <span>{user ? 'Log out' : 'Log in'}</span>
        </button>
      </aside>

      <main>{children}</main>
      {showGlobalAiAssistant ? <GlobalAiAssistant /> : null}
    </div>
  );
}

function NavList({ closeMobile }: { closeMobile?: () => void }) {
  const location = useLocation();
  const { profile } = useAuth();
  return (
    <nav className="nav-list" aria-label="Primary navigation">
      {sections.map((section) => {
        const items = navItems.filter((item) => item.group === section.key && (!('adminOnly' in item) || profile?.role === 'admin'));
        return (
          <div className="nav-section" key={section.key}>
            <small>{section.label}</small>
            {items.map((item) => (
              <Link className={location.pathname.startsWith(item.path) ? 'active' : ''} key={item.path} to={item.path} onClick={closeMobile}>
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        );
      })}
    </nav>
  );
}
