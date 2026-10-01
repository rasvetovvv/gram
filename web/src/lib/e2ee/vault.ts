// Device-local encrypted-at-rest persistence for GRAM E2EE secret state.
//
// SECRET material — device identity private keys, one-time prekey private halves, and live Double
// Ratchet session state — is wrapped under a non-extractable AES-GCM key held in IndexedDB and
// never leaves the browser. The server only ever receives public bundles (see api/app/e2ee.py).
//
// Threat model note: this protects against another site reading the values and against casual
// inspection, not against malware running as the user. True hardware-backed storage would need a
// platform key store; WebCrypto non-extractable keys in IndexedDB are the strongest primitive a
// browser offers without one, so that is what we use.

const DB_NAME = "gram-e2ee";
const DB_VERSION = 1;
const STORE = "vault";
const WRAP_KEY_ID = "wrap-key";

interface VaultRecord {
  id: string;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("e2ee: indexeddb open failed"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("e2ee: indexeddb op failed"));
    });
  } finally {
    db.close();
  }
}

/**
 * Fetch (or create once) the non-extractable AES-GCM wrapping key. Because it is non-extractable,
 * even code on this origin cannot read its raw bytes; it can only ask WebCrypto to encrypt or
 * decrypt with it. That is what keeps the vault contents opaque at rest.
 */
async function wrapKey(): Promise<CryptoKey> {
  const existing = await withStore<{ id: string; key: CryptoKey } | undefined>(
    "readonly",
    (store) => store.get(WRAP_KEY_ID) as IDBRequest<{ id: string; key: CryptoKey } | undefined>
  );
  if (existing?.key) return existing.key;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt"
  ]);
  await withStore("readwrite", (store) => store.put({ id: WRAP_KEY_ID, key }));
  return key;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Encrypt-and-store an arbitrary JSON-serializable secret under `id`. */
export async function vaultPut(id: string, value: unknown): Promise<void> {
  const key = await wrapKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const record: VaultRecord = { id, iv, ciphertext };
  await withStore("readwrite", (store) => store.put(record));
}

/** Load-and-decrypt a secret previously stored with `vaultPut`, or null if absent. */
export async function vaultGet<T>(id: string): Promise<T | null> {
  const record = await withStore<VaultRecord | undefined>(
    "readonly",
    (store) => store.get(id) as IDBRequest<VaultRecord | undefined>
  );
  if (!record) return null;
  const key = await wrapKey();
  // Copy the stored view into a fresh ArrayBuffer-backed array so its type is a plain BufferSource.
  const iv = new Uint8Array(record.iv);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    record.ciphertext
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function vaultDelete(id: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(id));
}

/** Wipe every E2EE secret on this device (e.g. on logout or "reset encryption"). */
export async function vaultClear(): Promise<void> {
  await withStore("readwrite", (store) => store.clear());
}

export const VAULT_KEYS = {
  device: (userId: string) => `device:${userId}`,
  session: (userId: string, chatId: string) => `session:${userId}:${chatId}`,
  // Which peer identity key the user has confirmed out of band for a secret chat.
  verification: (userId: string, chatId: string) => `verify:${userId}:${chatId}`,
  // This member's full sender-key group state (own key + every peer's imported key) for a group.
  group: (userId: string, chatId: string) => `group:${userId}:${chatId}`,
  groupSender: (userId: string, chatId: string) => `group-sender:${userId}:${chatId}`,
  groupReceiver: (userId: string, chatId: string, memberId: string) =>
    `group-recv:${userId}:${chatId}:${memberId}`,
  // Our OWN outgoing plaintext per chat, so the sender can still read their own messages after a
  // reload — a sending-chain ciphertext cannot be decrypted by the receiving chain.
  ownMessages: (userId: string, chatId: string) => `own:${userId}:${chatId}`
} as const;
