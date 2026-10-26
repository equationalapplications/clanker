// Native no-op. The hint exists only for the static web landing page; see
// signedInHint.web.ts.
export function setSignedInHint(_signedIn: boolean): void {}

export function hasSignedInHint(): boolean {
  return false
}
