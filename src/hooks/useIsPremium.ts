import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { getIsPremium } from '~/utilities/getIsPremium'
import { useAuth } from '~/auth/useAuth'

export const useIsPremium = (): boolean => {
  const { user } = useAuth()
  const [staleTime, setStaleTime] = useState<number>(60) // 1 minute

  const { data: isPremium, refetch } = useQuery<boolean>({
    queryKey: ['isPremium'],
    queryFn: getIsPremium,
    enabled: !!user,
    refetchOnWindowFocus: false,
    retry: 3,
    staleTime,
  })

  useEffect(() => {
    if (user && refetch) {
      refetch()
    }
  }, [user, refetch])

  useEffect(() => {
    if (isPremium === true) {
      setStaleTime(1800) // 30 minutes
    } else {
      setStaleTime(60) // 1 minute
    }
  }, [isPremium])

  return !!isPremium
}
