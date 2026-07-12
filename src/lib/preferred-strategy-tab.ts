/** Session key: after create/generate, open this strategy tab once. */
export const EA_PREFERRED_TAB_KEY = "ea-preferred-tab";

export function setPreferredStrategyTab(tab: string): void {
  try {
    sessionStorage.setItem(EA_PREFERRED_TAB_KEY, tab);
  } catch {
    // ignore quota / private mode
  }
}

export function consumePreferredStrategyTab(): string | null {
  try {
    const tab = sessionStorage.getItem(EA_PREFERRED_TAB_KEY);
    if (tab) sessionStorage.removeItem(EA_PREFERRED_TAB_KEY);
    return tab;
  } catch {
    return null;
  }
}
