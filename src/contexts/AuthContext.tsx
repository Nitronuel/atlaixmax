import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { ProfileUpdate, UserProfile } from '../services/ProfileService';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ needsEmailConfirmation: boolean }>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateProfile: (update: ProfileUpdate) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const loadSupabaseClient = async () => {
  const { authSupabase } = await import('../services/SupabaseClient');
  return authSupabase;
};

const loadProfileService = async () => {
  const { ProfileService } = await import('../services/ProfileService');
  return ProfileService;
};

const requireSupabase = async () => {
  const authSupabase = await loadSupabaseClient();
  if (!authSupabase) {
    throw new Error('Sign in is temporarily unavailable. Add Supabase auth configuration and try again.');
  }
  return authSupabase;
};

const getDisplayName = (user: User) => {
  const metadata = user.user_metadata || {};
  return String(metadata.display_name || metadata.full_name || metadata.name || user.email?.split('@')[0] || 'Atlaix User');
};

const isStorageQuotaError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return /quota|setitem|storage/i.test(message);
};

const clearAtlaixLocalCaches = () => {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const cacheKeys = [
    'atlaix-live-alpha-cache',
    'atlaix-live-alpha-feed-order-v1',
    'atlaix-live-alpha-feed-snapshot-v1',
    'atlaix-detection-events-cache',
    'atlaix-global-events-cache',
    'atlaix-global-ai-assistant-v2',
    'atlaix-ai-assistant-chat-v1',
    'atlaix-forensic-report:index'
  ];
  const cachePrefixes = [
    'atlaix-token-activity-cache:',
    'atlaix-safe-scan-report:',
    'atlaix-forensic-report:',
    'atlaix-global-',
    'atlaix-detection-'
  ];

  for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
    const key = window.localStorage.key(index);
    if (!key) continue;
    if (cacheKeys.includes(key) || cachePrefixes.some((prefix) => key.startsWith(prefix))) {
      window.localStorage.removeItem(key);
    }
  }
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [authConfigAvailable, setAuthConfigAvailable] = useState(true);

  const loadProfile = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setProfile(null);
      setProfileError(null);
      return;
    }

    try {
      const ProfileService = await loadProfileService();
      const ensured = await ProfileService.ensureProfile({
        id: nextUser.id,
        email: nextUser.email || '',
        displayName: getDisplayName(nextUser)
      });
      setProfile(ensured);
      setProfileError(null);
    } catch (error: any) {
      setProfile(null);
      setProfileError(error?.message || 'Profile could not be loaded.');
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const loadSession = async () => {
      const authSupabase = await loadSupabaseClient();
      if (!mounted) return;

      if (!authSupabase) {
        setAuthConfigAvailable(false);
        setLoading(false);
        return;
      }

      setAuthConfigAvailable(true);
      const { data } = await authSupabase.auth.getSession();
      if (!mounted) return;

      const nextSession = data.session;
      setSession(nextSession);
      setUser(nextSession?.user || null);
      await loadProfile(nextSession?.user || null);
      if (mounted) setLoading(false);

      const { data: listener } = authSupabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        setUser(nextSession?.user || null);
        void loadProfile(nextSession?.user || null);
      });

      unsubscribe = () => listener.subscription.unsubscribe();
    };

    loadSession().catch((error) => {
      console.error('Auth session load failed', error);
      if (mounted) setLoading(false);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const supabase = await requireSupabase();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return;

    if (isStorageQuotaError(error)) {
      clearAtlaixLocalCaches();
      const retry = await supabase.auth.signInWithPassword({ email, password });
      if (!retry.error) return;
      throw retry.error;
    }

    throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string, displayName?: string) => {
    const supabase = await requireSupabase();
    const options = {
      data: { display_name: displayName || email.split('@')[0] },
      emailRedirectTo: `${window.location.origin}/dashboard`
    };
    const { data, error } = await supabase.auth.signUp({ email, password, options });

    if (error) {
      if (isStorageQuotaError(error)) {
        clearAtlaixLocalCaches();
        const retry = await supabase.auth.signUp({ email, password, options });
        if (!retry.error) return { needsEmailConfirmation: Boolean(retry.data.user && !retry.data.session) };
        throw retry.error;
      }
      throw error;
    }

    return { needsEmailConfirmation: Boolean(data.user && !data.session) };
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const supabase = await requireSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` }
    });
    if (error) throw error;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = await requireSupabase();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    setProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const supabase = await requireSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`
    });
    if (error) throw error;
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(user);
  }, [loadProfile, user]);

  const updateProfile = useCallback(async (update: ProfileUpdate) => {
    if (!user) throw new Error('You need to be signed in to update your profile.');
    const ProfileService = await loadProfileService();
    const nextProfile = await ProfileService.updateProfile(user.id, update);
    setProfile(nextProfile);
  }, [user]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    session,
    profile,
    loading,
    profileError: authConfigAvailable ? profileError : 'Account access is temporarily unavailable.',
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    resetPassword,
    updateProfile,
    refreshProfile
  }), [authConfigAvailable, loading, profile, profileError, refreshProfile, resetPassword, session, signIn, signInWithGoogle, signOut, signUp, updateProfile, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
};
