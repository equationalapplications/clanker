import React, { createContext, useContext, ReactNode } from 'react'
import { User } from 'firebase/auth'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { useAuthentication } from './useAuthentication'

interface AuthContextType {
    firebaseUser: User | null
    supabaseUser: SupabaseUser | null
    isLoading: boolean
    error: string | null
}

const AuthContext = createContext<AuthContextType | null>(null)

interface AuthProviderProps {
    children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
    const auth = useAuthentication()
    
    return (
        <AuthContext.Provider value={auth}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext)
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}