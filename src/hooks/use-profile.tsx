"use client";

import * as React from "react";
import { supabaseAnon } from "@/lib/supabase";
import { getDefaultAvatar } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { UserPlan } from "@/lib/constants";

interface Plan {
  id: string;
  plan_name: UserPlan;
  monthly_email_limit: number;
  monthly_cost: number;
  channel_limit: number;
  features: Record<string, unknown>;
}

interface Subscription {
  id: string;
  profile_id: string;
  plan: Plan;
  // Add other subscription fields if needed
}

interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  avatar_url: string | null;
  plan: UserPlan; // Keep for backward compatibility
  subscription: Subscription | null;
}

interface ProfileContext {
  profile: Profile | null;
  isLoading: boolean;
  error: Error | null;
  refreshProfile: () => Promise<void>;
}

// Cache for profile data
let profileCache: {
  profile: Profile | null;
  timestamp: number;
} | null = null;

const CACHE_DURATION = 30000; // 30 seconds

const ProfileContext = React.createContext<ProfileContext | undefined>(
  undefined
);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = React.useState<Profile | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);
  const loadingRef = React.useRef(false);

  const loadProfile = React.useCallback(async (force = false) => {
    if (loadingRef.current) return;

    // Check cache if not forcing refresh
    if (
      !force &&
      profileCache &&
      Date.now() - profileCache.timestamp < CACHE_DURATION
    ) {
      setProfile(profileCache.profile);
      setIsLoading(false);
      return;
    }

    loadingRef.current = true;

    try {
      setIsLoading(true);
      const {
        data: { user },
      } = await supabaseAnon.auth.getUser();

      if (!user) {
        setProfile(null);
        profileCache = { profile: null, timestamp: Date.now() };
        return;
      }

      const { data: profile, error } = await supabaseAnon
        .from("profiles")
        .select(
          `
          *,
          subscription:subscriptions(
            plan:plans(*)
          )
        `
        )
        .eq("id", user.id)
        .single();

      logger.info("Profile data", {
        prefix: "ProfileProvider",
        data: profile,
      });

      if (error) throw error;

      const profileData = {
        ...profile,
        email: user.email,
        avatar_url:
          profile.avatar_url || getDefaultAvatar({ email: profile.email }),
        plan:
          (profile.subscription?.plan.plan_name.toLowerCase() as UserPlan) ||
          "free",
      };

      setProfile(profileData);
      profileCache = { profile: profileData, timestamp: Date.now() };
    } catch (e) {
      console.error("Error loading profile:", e);
      setError(e instanceof Error ? e : new Error("Failed to load profile"));
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    loadProfile();

    const {
      data: { subscription },
    } = supabaseAnon.auth.onAuthStateChange(() => {
      loadProfile(true); // Force refresh on auth state change
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const refreshProfile = React.useCallback(
    () => loadProfile(true),
    [loadProfile]
  );

  return (
    <ProfileContext.Provider
      value={{
        profile,
        isLoading,
        error,
        refreshProfile,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  const context = React.useContext(ProfileContext);
  if (context === undefined) {
    throw new Error("useProfile must be used within a ProfileProvider");
  }
  return context;
}
