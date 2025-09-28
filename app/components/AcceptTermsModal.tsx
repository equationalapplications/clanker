import React, { useState } from 'react';
import { Modal, View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import Button from './Button';
import { supabase } from '../config/supabaseClient';
import { useUser } from '../hooks/useUser';

interface AcceptTermsModalProps {
    visible: boolean;
    onAccept: () => void;
    onDecline: () => void;
    appName: string;
    termsVersion: string;
    isUpdate?: boolean; // true if this is a terms update, false for first-time
    onViewFullTerms?: () => void; // Callback to navigate to full terms page
}

const TERMS_CONTENT = {
    'yours-brightly': {
        title: 'Terms of Service - Yours Brightly AI',
        summary: `
By using Yours Brightly AI, you agree to these key terms:

• AI Character Creation: Create and customize AI characters for personal use while following community guidelines

• Data Usage: Your conversations help improve our AI models. Personal information is handled according to our Privacy Policy

• Subscription & Billing: Premium features require an active subscription through your app store

• Prohibited Uses: No harmful, illegal, or inappropriate content. Respect other users and community guidelines

• Service Availability: We strive for reliable service but cannot guarantee uninterrupted access

• Amendments: We may modify these terms at any time. Continued use constitutes acceptance of changes

• Contact: For questions, contact support@yoursbrightly.ai

For the complete terms and conditions, please tap "View Full Terms" below.

Last updated: September 28, 2025 • Version: 2.0
`,
        fullTermsAvailable: true
    }
};

export function AcceptTermsModal({
    visible,
    onAccept,
    onDecline,
    appName,
    termsVersion,
    isUpdate = false,
    onViewFullTerms
}: AcceptTermsModalProps) {
    const [loading, setLoading] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const user = useUser();

    const termsData = TERMS_CONTENT[appName as keyof typeof TERMS_CONTENT];

    const handleAccept = async () => {
        if (!user?.uid) {
            Alert.alert('Error', 'User not authenticated');
            return;
        }

        setLoading(true);
        try {
            // Call the grant_app_access function to record terms acceptance
            const { error } = await supabase.rpc('grant_app_access', {
                p_user_id: user.uid,
                p_app_name: appName,
                p_terms_version: termsVersion
            });

            if (error) {
                console.error('Failed to record terms acceptance:', error);
                Alert.alert('Error', 'Failed to record terms acceptance. Please try again.');
                return;
            }

            console.log(`✅ Terms accepted for ${appName} v${termsVersion}`);
            onAccept();
        } catch (error) {
            console.error('Error accepting terms:', error);
            Alert.alert('Error', 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleScroll = (event: any) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const isAtBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 20;
        setHasScrolledToBottom(isAtBottom);
    };

    if (!termsData) {
        return null;
    }

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="formSheet"
            onRequestClose={onDecline}
        >
            <View style={{ flex: 1, backgroundColor: '#fff', padding: 20 }}>
                {/* Header */}
                <View style={{ marginBottom: 20, alignItems: 'center' }}>
                    <Text style={{ fontSize: 24, fontWeight: 'bold', textAlign: 'center' }}>
                        {isUpdate ? 'Updated Terms of Service' : termsData.title}
                    </Text>
                    <Text style={{ fontSize: 16, color: '#666', marginTop: 8, textAlign: 'center' }}>
                        Version {termsVersion}
                    </Text>
                    {isUpdate && (
                        <View style={{
                            backgroundColor: '#FFF3CD',
                            padding: 12,
                            borderRadius: 8,
                            marginTop: 12,
                            borderLeftWidth: 4,
                            borderLeftColor: '#FFB020'
                        }}>
                            <Text style={{ fontSize: 14, color: '#856404' }}>
                                Our terms have been updated. Please review and accept the new version to continue using the app.
                            </Text>
                        </View>
                    )}
                </View>

                {/* Terms Content */}
                <ScrollView
                    style={{ flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 16 }}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                >
                    <Text style={{ fontSize: 14, lineHeight: 20 }}>
                        {termsData.summary}
                    </Text>
                </ScrollView>

                {/* View Full Terms Button */}
                {termsData.fullTermsAvailable && onViewFullTerms && (
                    <View style={{ alignItems: 'center', marginVertical: 12 }}>
                        <Button
                            onPress={onViewFullTerms}
                            mode="outlined"
                            style={{ borderColor: '#0066cc' }}
                        >
                            View Full Terms & Conditions
                        </Button>
                    </View>
                )}

                {/* Scroll Indicator */}
                {!hasScrolledToBottom && (
                    <View style={{
                        alignItems: 'center',
                        marginVertical: 12,
                        padding: 8,
                        backgroundColor: '#E3F2FD',
                        borderRadius: 6
                    }}>
                        <Text style={{ fontSize: 12, color: '#1976D2' }}>
                            Please scroll down to read all terms before accepting
                        </Text>
                    </View>
                )}

                {/* Action Buttons */}
                <View style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    marginTop: 20,
                    gap: 12
                }}>
                    <Button
                        onPress={onDecline}
                        mode="outlined"
                        style={{
                            flex: 1,
                            opacity: loading ? 0.5 : 1
                        }}
                        disabled={loading}
                    >
                        Decline
                    </Button>
                    <Button
                        onPress={handleAccept}
                        mode="contained"
                        style={{
                            flex: 2,
                            opacity: (!hasScrolledToBottom || loading) ? 0.5 : 1
                        }}
                        disabled={!hasScrolledToBottom || loading}
                    >
                        {loading ? 'Accepting...' : 'Accept Terms'}
                    </Button>
                </View>

                {loading && (
                    <View style={{ alignItems: 'center', marginTop: 12 }}>
                        <ActivityIndicator size="small" color="#0066cc" />
                        <Text style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                            Recording your acceptance...
                        </Text>
                    </View>
                )}
            </View>
        </Modal>
    );
}