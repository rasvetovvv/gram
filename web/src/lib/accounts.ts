import type { User } from "./types";

/**
 * The accounts this browser has signed into, for the account switcher.
 *
 * Sessions live in httpOnly cookies, so the roster cannot hold anything that authenticates:
 * it stores only what is needed to draw a row — handle, name, avatar — and switching asks for
 * the password again. Storing a credential here would trade the whole point of httpOnly away.
 */
export type RememberedAccount = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  /** Sorted by this, so the switcher lists the most recently used first. */
  last_used_at: string;
};

const KEY = "gram.accounts";
const LIMIT = 6;

function read(): RememberedAccount[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is RememberedAccount =>
        Boolean(item) &&
        typeof (item as RememberedAccount).username === "string" &&
        typeof (item as RememberedAccount).id === "string"
    );
  } catch {
    // A corrupted roster is not worth a crash on the login screen.
    return [];
  }
}

function write(accounts: RememberedAccount[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(accounts.slice(0, LIMIT)));
    // Same-tab listeners need a nudge; `storage` only fires in other tabs.
    window.dispatchEvent(new Event("gram:accounts"));
  } catch {
    // Private mode or a full quota: the switcher degrades to "one account", not to an error.
  }
}

export function listAccounts(): RememberedAccount[] {
  return read().sort((a, b) => b.last_used_at.localeCompare(a.last_used_at));
}

export function rememberAccount(user: User) {
  const rest = read().filter((item) => item.id !== user.id);
  write([
    {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url ?? null,
      last_used_at: new Date().toISOString()
    },
    ...rest
  ]);
}

export function forgetAccount(id: string) {
  write(read().filter((item) => item.id !== id));
}
