import { useEffect, useState } from "react"
import { useQuery } from "react-query"

import useUser from "./useUser"
import { getIsPremium } from "../utilities/getIsPremium"

export const useIsPremium = (): boolean => {
  const user = useUser()
  const [staleTime, setStaleTime] = useState<number>(60) // 1 minute

  const { data: isPremium, refetch } = useQuery<boolean>("isPremium", getIsPremium, {
    enabled: !!user,
    refetchOnWindowFocus: false,
    retry: 3,
    staleTime,
    useErrorBoundary: true,
  })

  useEffect(() => {
    if (user) {
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
