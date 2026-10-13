/**
 * Web / desktop: no background mode to manage (the tab or desktop app keeps replies running while it
 * is open) and no system notifications. Same API as background.ts.
 */
export async function isBackgroundEnabled() {
  return false;
}

export function subscribeBackgroundEnabled(fn: (v: boolean) => void) {
  fn(false);
  return () => {};
}

export async function setBackgroundEnabled(_v: boolean) {}

export async function syncBackgroundWork(_count: number, _progress?: string) {}

export async function notifyIfBackground(_conversationId: string, _title: string, _body: string) {}
