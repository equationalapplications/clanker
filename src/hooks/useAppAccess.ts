import { useEffect, useState } from 'react'
import { checkAppAccess, getUserAppPermissions } from '../utilities/appAccess'
import { useAuth } from './useAuth'

interface UseAppAccessResult {
    hasAccess: boolean
    hasAcceptedTerms: boolean
    isLoading: boolean
    permissions: any[] | null
    error: string | null
    refetch: () => Promise<void>
}

export function useAppAccess(appName: string = 'yours-brightly'): UseAppAccessResult {
    const { supabaseUser } = useAuth()
    const [hasAccess, setHasAccess] = useState(false)
    const [hasAcceptedTerms, setHasAcceptedTerms] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [permissions, setPermissions] = useState<any[] | null>(null)
    const [error, setError] = useState<string | null>(null)

    const checkAccess = async () => {
        if (!supabaseUser) {
            setHasAccess(false)
            setHasAcceptedTerms(false)
            setPermissions(null)
            setIsLoading(false)
            return
        }

        setIsLoading(true)
        setError(null)

        try {
            console.log(`Checking ${appName} access for user:`, supabaseUser.id)

            // Check JWT claims for app access
            const jwtAccess = await checkAppAccess(appName)

            // Get database permissions
            const permissionsResult = await getUserAppPermissions()

            if (permissionsResult.success && permissionsResult.permissions) {
                const userPermissions = permissionsResult.permissions
                const appPermission = userPermissions.find(p => p.app_name === appName)

                setPermissions(userPermissions)
                // Temporarily use only database permission until JWT claims are fixed
                setHasAccess(!!appPermission)
                setHasAcceptedTerms(!!appPermission?.terms_accepted_at)

                console.log(`${appName} access status:`, {
                    jwtAccess,
                    dbPermission: !!appPermission,
                    termsAccepted: !!appPermission?.terms_accepted_at,
                    hasAccess: !!appPermission // Using DB permission only for now
                })
            } else {
                setPermissions(null)
                setHasAccess(jwtAccess)
                setHasAcceptedTerms(false)

                if (permissionsResult.error) {
                    setError(permissionsResult.error)
                }
            }
        } catch (err: any) {
            console.error('Error checking app access:', err)
            setError(err.message || 'Failed to check app access')
            setHasAccess(false)
            setHasAcceptedTerms(false)
            setPermissions(null)
        } finally {
            setIsLoading(false)
        }
    }

    useEffect(() => {
        checkAccess()
    }, [supabaseUser, appName])

    return {
        hasAccess,
        hasAcceptedTerms,
        isLoading,
        permissions,
        error,
        refetch: checkAccess
    }
}