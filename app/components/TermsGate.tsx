import React, { useEffect, useState } from 'react';
import { AcceptTermsModal } from './AcceptTermsModal';
import { useAcceptTerms, useTermsAcceptanceRequired } from '../hooks/useAcceptTerms';

interface TermsGateProps {
    children: React.ReactNode;
    appName?: string;
    onTermsAccepted?: () => void;
    onTermsDeclined?: () => void;
}

/**
 * TermsGate component that wraps your app content and shows the terms modal
 * when terms acceptance is required.
 */
export function TermsGate({
    children,
    appName = 'yours-brightly',
    onTermsAccepted,
    onTermsDeclined,
}: TermsGateProps) {
    const [showTermsModal, setShowTermsModal] = useState(false);
    const termsRequired = useTermsAcceptanceRequired();
    const {
        needsAcceptance,
        currentVersion,
        userAcceptedVersion,
        loading,
        refreshTermsStatus
    } = useAcceptTerms();

    // Show modal when terms acceptance is required
    useEffect(() => {
        if (!loading && needsAcceptance) {
            setShowTermsModal(true);
        } else {
            setShowTermsModal(false);
        }
    }, [loading, needsAcceptance]);

    const handleTermsAccepted = () => {
        console.log('✅ Terms accepted, refreshing status...');
        setShowTermsModal(false);

        // Refresh the terms status to update JWT claims
        setTimeout(() => {
            refreshTermsStatus();
        }, 1000);

        onTermsAccepted?.();
    };

    const handleTermsDeclined = () => {
        console.log('❌ Terms declined');
        setShowTermsModal(false);
        onTermsDeclined?.();

        // You might want to sign out the user or show an error message
        // For now, we'll keep the modal available to show again
        setTimeout(() => {
            if (needsAcceptance) {
                setShowTermsModal(true);
            }
        }, 3000); // Show again after 3 seconds
    };

    // Determine if this is a terms update scenario
    const isTermsUpdate = userAcceptedVersion && userAcceptedVersion !== currentVersion;

    return (
        <>
            {children}

            <AcceptTermsModal
                visible={showTermsModal}
                onAccept={handleTermsAccepted}
                onDecline={handleTermsDeclined}
                appName={appName}
                termsVersion={currentVersion}
                isUpdate={isTermsUpdate}
            />
        </>
    );
}

export default TermsGate;