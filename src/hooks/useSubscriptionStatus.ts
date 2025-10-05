import { useState, useEffect } from 'react';
import { supabaseClient } from '../config/supabaseClient';
import { YOURS_BRIGHTLY_TERMS } from '../config/termsConfig';

interface SubscriptionStatus {
    needsTermsAcceptance: boolean;
    isUpdate: boolean;
    isLoading: boolean;
}

export function useSubscriptionStatus(): SubscriptionStatus {
    const [needsTermsAcceptance, setNeedsTermsAcceptance] = useState(false);
    const [isUpdate, setIsUpdate] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const checkStatus = async () => {
            setIsLoading(true);
            try {
                const { data: { session } } = await supabaseClient.auth.getSession();

                if (session) {
                    const payload = JSON.parse(atob(session.access_token.split('.')[1]));
                    const plans = payload.plans || [];
                    const appPlan = plans.find((plan: any) => plan.app === 'yours-brightly');

                    if (!appPlan || !appPlan.terms_accepted) {
                        setNeedsTermsAcceptance(true);
                        setIsUpdate(false);
                    } else if (appPlan.terms_version !== YOURS_BRIGHTLY_TERMS.version) {
                        setNeedsTermsAcceptance(true);
                        setIsUpdate(true);
                    } else {
                        setNeedsTermsAcceptance(false);
                        setIsUpdate(false);
                    }
                } else {
                    setNeedsTermsAcceptance(false);
                    setIsUpdate(false);
                }
            } catch (error) {
                console.error("Error checking subscription status:", error);
                setNeedsTermsAcceptance(false);
                setIsUpdate(false);
            } finally {
                setIsLoading(false);
            }
        };

        checkStatus();

        const { data: authListener } = supabaseClient.auth.onAuthStateChange(
            (event, session) => {
                if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'SIGNED_OUT') {
                    checkStatus();
                }
            }
        );

        return () => {
            authListener.subscription.unsubscribe();
        };
    }, []);

    return { needsTermsAcceptance, isUpdate, isLoading };
}
