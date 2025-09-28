import React, { useState } from 'react';
import { Modal, View, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import Button from './Button';
import { supabase } from '../config/supabaseClient';
import { useUser } from '../hooks/useUser';
import { getTermsForApp } from '../config/termsConfig';

interface AcceptTermsModalProps {
    visible: boolean;
    onAccept: () => void;
    onDecline: () => void;
    appName: string;
    termsVersion: string;
    isUpdate?: boolean; // true if this is a terms update, false for first-time
    onViewFullTerms?: () => void; // Callback to navigate to full terms page
}

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

    const termsConfig = getTermsForApp(appName);

    if (!termsConfig) {
        return null; // No terms configured for this app
    }

    const handleAccept = async () => {
        if (!user?.uid) {
            Alert.alert('Error', 'You must be signed in to accept terms');
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.rpc('grant_app_access', {
                p_user_id: user.uid,
                p_app_name: appName,
                p_terms_version: termsVersion
            });

            if (error) {
                console.error('Error granting app access:', error);
                Alert.alert('Error', 'Failed to record terms acceptance. Please try again.');
            } else {
                onAccept();
            }
        } catch (error) {
            console.error('Error accepting terms:', error);
            Alert.alert('Error', 'An unexpected error occurred. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleScroll = (event: any) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const isScrolledToBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 10;
        setHasScrolledToBottom(isScrolledToBottom);
    };

    if (!visible) {
        return null;
    }

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onDecline}
        >
            <View style={{ flex: 1, backgroundColor: '#fff' }}>
                {/* Header */}
                <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: '#e0e0e0' }}>
                    <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center' }}>
                        {isUpdate ? 'Updated Terms of Service' : 'Terms of Service'}
                    </Text>
                    <Text style={{ fontSize: 14, color: '#666', textAlign: 'center', marginTop: 4 }}>
                        Version {termsConfig.version} • {termsConfig.lastUpdated}
                    </Text>
                </View>

                {/* Summary Content */}
                <ScrollView
                    style={{ flex: 1, padding: 20 }}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                    showsVerticalScrollIndicator={true}
                >
                    <Text style={{ fontSize: 16, lineHeight: 24, color: '#333' }}>
                        {termsConfig.summary}
                    </Text>

                    {/* View Full Terms Button */}
                    {onViewFullTerms && (
                        <View style={{ marginVertical: 20, alignItems: 'center' }}>
                            <Button
                                onPress={onViewFullTerms}
                                mode="outlined"
                                style={{ minWidth: 200 }}
                            >
                                View Full Terms
                            </Button>
                        </View>
                    )}

                    {/* Scroll indicator */}
                    {!hasScrolledToBottom && (
                        <View style={{
                            alignItems: 'center',
                            marginTop: 20,
                            paddingBottom: 20
                        }}>
                            <Text style={{
                                fontSize: 12,
                                color: '#666',
                                fontStyle: 'italic'
                            }}>
                                Please scroll to the bottom to continue
                            </Text>
                        </View>
                    )}

                    {/* Spacer to ensure scroll works */}
                    <View style={{ height: 50 }} />
                </ScrollView>

                {/* Action buttons */}
                <View style={{
                    flexDirection: 'row',
                    padding: 20,
                    borderTopWidth: 1,
                    borderTopColor: '#e0e0e0',
                    backgroundColor: '#f8f9fa',
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