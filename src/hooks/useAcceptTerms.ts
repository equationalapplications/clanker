import { useEffect, useState } from 'react';
import { supabaseClient } from '../config/supabaseClient';
import { useAuth } from './useAuth';
import { CURRENT_TERMS } from '../config/termsConfig';

interface TermsStatus {
  needsAcceptance: boolean;
  currentVersion: string;
  userAcceptedVersion?: string;
  lastAcceptedAt?: string;
  loading: boolean;
  error?: string;
}

const APP_NAME = 'yours-brightly';

export function useAcceptTerms(): TermsStatus & { refreshTermsStatus: () => void } {
  const [termsStatus, setTermsStatus] = useState<TermsStatus>({
    needsAcceptance: false,
    currentVersion: CURRENT_TERMS.version,
    loading: true,
  });

  const { user } = useAuth();

  useEffect(() => {
    if (!user?.uid) {
      setTermsStatus(prev => ({
        ...prev,
        loading: false,
        needsAcceptance: false
      }));
      return;
    }

    checkTermsStatus();
  }, [user?.uid]);

  const checkTermsStatus = async () => {
    try {
      setTermsStatus(prev => ({ ...prev, loading: true, error: undefined }));

      // Query user's current terms acceptance status
      const { data, error } = await supabaseClient
        .from('user_app_permissions')
        .select('terms_version, terms_accepted_at')
        .eq('user_id', user!.uid)
        .eq('app_name', APP_NAME)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
        throw error;
      }

      let needsAcceptance = true;
      let userAcceptedVersion: string | undefined;
      let lastAcceptedAt: string | undefined;

      if (data) {
        userAcceptedVersion = data.terms_version;
        lastAcceptedAt = data.terms_accepted_at;

        // User needs to accept terms if:
        // 1. They haven't accepted any terms (terms_accepted_at is null)
        // 2. Their accepted version is different from current version
        needsAcceptance = !data.terms_accepted_at ||
          data.terms_version !== CURRENT_TERMS.version;
      }

      setTermsStatus({
        needsAcceptance,
        currentVersion: CURRENT_TERMS.version,
        userAcceptedVersion,
        lastAcceptedAt,
        loading: false,
      });

      console.log('📋 Terms status check:', {
        needsAcceptance,
        currentVersion: CURRENT_TERMS.version,
        userAcceptedVersion,
        lastAcceptedAt,
      });
    } catch (error: any) {
      console.error('Error checking terms status:', error);
      setTermsStatus(prev => ({
        ...prev,
        loading: false,
        error: error.message || 'Failed to check terms status',
      }));
    }
  };

  const refreshTermsStatus = () => {
    if (user?.uid) {
      checkTermsStatus();
    }
  };

  return {
    ...termsStatus,
    refreshTermsStatus,
  };
}

// Helper function to check if user needs terms acceptance (for use in components)
export function useTermsAcceptanceRequired(): boolean {
  const { needsAcceptance, loading } = useAcceptTerms();
  return !loading && needsAcceptance;
}
