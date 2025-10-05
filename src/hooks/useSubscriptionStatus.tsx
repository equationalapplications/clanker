import React, { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { supabaseClient } from '~/config/supabaseClient';
import { YOURS_BRIGHTLY_TERMS } from '~/config/termsConfig';

interface SubscriptionStatus {
    needsTermsAcceptance: boolean;
    isUpdate: boolean;
    isLoading: boolean;
    markTermsAccepted: () => void;
}

// Create context for shared state across all instances
const SubscriptionStatusContext = createContext<SubscriptionStatus | null>(null);

// Provider component
export function SubscriptionStatusProvider({ children }: { children: ReactNode }): React.ReactElement {
    const [needsTermsAcceptance, setNeedsTermsAcceptance] = useState(false);
    const [isUpdate, setIsUpdate] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [localTermsAccepted, setLocalTermsAccepted] = useState(false);

    const checkStatus = async () => {
        setIsLoading(true);
        try {
            // If user already accepted terms optimistically, don't block them
            if (localTermsAccepted) {
                setNeedsTermsAcceptance(false);
                setIsUpdate(false);
                setIsLoading(false);
                return;
            }

            const { data: { session } } = await supabaseClient.auth.getSession();

            if (session) {
                const payload = JSON.parse(atob(session.access_token.split('.')[1]));
                const plans = payload.plans || [];
                const appPlan = plans.find((plan: any) => plan.app === 'yours-brightly');

                if (!appPlan || !appPlan.terms_accepted) {
                    // No plan or terms not accepted yet
                    setNeedsTermsAcceptance(true);
                    setIsUpdate(false);
                } else if (appPlan.terms_version !== YOURS_BRIGHTLY_TERMS.version) {
                    // Terms version mismatch - need to accept new version
                    setNeedsTermsAcceptance(true);
                    setIsUpdate(true);
                } else {
                    // All good - has plan and accepted current terms
                    setNeedsTermsAcceptance(false);
                    setIsUpdate(false);
                }
            } else {
                setNeedsTermsAcceptance(false);
                setIsUpdate(false);
            }
        } catch (error) {
            console.error("Error checking subscription status:", error);
            // On error, trust local state if available
            if (localTermsAccepted) {
                setNeedsTermsAcceptance(false);
            } else {
                setNeedsTermsAcceptance(false);
            }
            setIsUpdate(false);
        } finally {
            setIsLoading(false);
        }
    };

    // Allow optimistic update - user clicked accept, let them through
    const markTermsAccepted = () => {
        console.log('[SubscriptionStatusContext] markTermsAccepted called');
        console.log('[SubscriptionStatusContext] Setting localTermsAccepted = true');
        setLocalTermsAccepted(true);
        console.log('[SubscriptionStatusContext] Setting needsTermsAcceptance = false');
        setNeedsTermsAcceptance(false);
        console.log('[SubscriptionStatusContext] Setting isUpdate = false');
        setIsUpdate(false);
        console.log('[SubscriptionStatusContext] State updates complete');
    };

    useEffect(() => {
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
    }, [localTermsAccepted]);

    return (
        <SubscriptionStatusContext.Provider value={{ needsTermsAcceptance, isUpdate, isLoading, markTermsAccepted }}>
            {children}
        </SubscriptionStatusContext.Provider>
    );
}

// Hook to use the subscription status
export function useSubscriptionStatus(): SubscriptionStatus {
    const context = useContext(SubscriptionStatusContext);
    if (!context) {
        throw new Error('useSubscriptionStatus must be used within SubscriptionStatusProvider');
    }
    return context;
}
