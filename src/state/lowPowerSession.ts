let amberShownThisSession = false

export function getAmberShownThisSession(): boolean {
  return amberShownThisSession
}

export function setAmberShownThisSession(): void {
  amberShownThisSession = true
}

export function resetLowPowerSession(): void {
  amberShownThisSession = false
}
