import { useEffect } from 'react'

/**
 * Module-level ref that the tab layout reads to decide whether to
 * show an "unsaved changes" alert before navigating away.
 */
export const editDirtyRef = { current: false }

/**
 * Hook for the edit screen to track dirty (unsaved) state.
 * Compares current form values against the values loaded from the database.
 */
export function useEditDirtyState(
    currentValues: Record<string, string>,
    loadedValues: Record<string, string> | null,
) {
    useEffect(() => {
        if (!loadedValues) {
            editDirtyRef.current = false
            return
        }

        const isDirty = Object.keys(currentValues).some(
            (key) => (currentValues[key] ?? '') !== (loadedValues[key] ?? ''),
        )
        editDirtyRef.current = isDirty

        return () => {
            editDirtyRef.current = false
        }
    }, [currentValues, loadedValues])
}
