// Test-only globals exposed by the app (dev or ?e2e) and the landing intro.
export {}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __one: any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __oneIntro?: any
  }
}
