import { authSupabase } from './SupabaseClient';

export type UserPlan = 'free' | 'pro' | 'admin';
export type UserRole = 'user' | 'admin';

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  plan: UserPlan;
  role: UserRole;
  onboarding_completed: boolean;
  preferred_chain: string;
  created_at: string;
  updated_at: string;
}

export type ProfileUpdate = Partial<Pick<UserProfile, 'display_name' | 'avatar_url' | 'preferred_chain' | 'onboarding_completed'>>;

const normalizeProfile = (row: any): UserProfile => ({
  id: row.id,
  email: row.email || '',
  display_name: row.display_name || row.email?.split('@')[0] || 'Atlaix User',
  avatar_url: row.avatar_url || null,
  plan: row.plan || 'free',
  role: row.role || 'user',
  onboarding_completed: Boolean(row.onboarding_completed),
  preferred_chain: row.preferred_chain || 'solana',
  created_at: row.created_at || new Date().toISOString(),
  updated_at: row.updated_at || new Date().toISOString()
});

export const ProfileService = {
  getProfile: async (userId: string): Promise<UserProfile | null> => {
    if (!authSupabase) return null;

    const { data, error } = await authSupabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) throw error;
    return data ? normalizeProfile(data) : null;
  },

  ensureProfile: async (args: { id: string; email?: string; displayName?: string }): Promise<UserProfile | null> => {
    if (!authSupabase) return null;

    const existing = await ProfileService.getProfile(args.id);
    if (existing) return existing;

    const now = new Date().toISOString();
    const profile = {
      id: args.id,
      email: args.email || '',
      display_name: args.displayName || args.email?.split('@')[0] || 'Atlaix User',
      avatar_url: null,
      plan: 'free',
      role: 'user',
      onboarding_completed: false,
      preferred_chain: 'solana',
      created_at: now,
      updated_at: now
    };

    const { data, error } = await authSupabase
      .from('profiles')
      .insert(profile)
      .select('*')
      .single();

    if (error) throw error;
    return normalizeProfile(data);
  },

  updateProfile: async (userId: string, update: ProfileUpdate): Promise<UserProfile | null> => {
    if (!authSupabase) return null;

    const { data, error } = await authSupabase
      .from('profiles')
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('*')
      .single();

    if (error) throw error;
    return normalizeProfile(data);
  }
};
