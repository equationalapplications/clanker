import { StyleSheet, View } from 'react-native';
import { AcceptTerms } from '~/components/AcceptTerms';

export default function AcceptTermsScreen() {
    return (
        <View style={styles.container}>
            <AcceptTerms />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
});
