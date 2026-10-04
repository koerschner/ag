// This device's copy of the board and recently read transcripts (IndexedDB "ag-dash", store "kv"), so launching,
// reloading and switching chats paint at once and stay readable while ag-dash restarts or the network drops.
let dbp: Promise<IDBDatabase> | null = null;
const db = () =>
	(dbp ||= new Promise((res, rej) => {
		const r = indexedDB.open("ag-dash", 1);
		r.onupgradeneeded = () => r.result.createObjectStore("kv");
		r.onsuccess = () => res(r.result);
		r.onerror = () => rej(r.error);
	}));
const run = <T>(mode: IDBTransactionMode, fn: (st: IDBObjectStore) => IDBRequest | void) =>
	db().then(
		(d) =>
			new Promise<T>((res, rej) => {
				const t = d.transaction("kv", mode);
				const req = fn(t.objectStore("kv"));
				t.oncomplete = () => res(req ? (req.result as T) : (undefined as T));
				t.onerror = t.onabort = () => rej(t.error);
			}),
	);
export const kv = {
	get: <T>(k: string) => run<T>("readonly", (st) => st.get(k)).catch(() => undefined),
	set: (k: string, v: unknown) => run("readwrite", (st) => void st.put(v, k)).catch(() => {}),
	del: (k: string) => run("readwrite", (st) => void st.delete(k)).catch(() => {}),
};

// localStorage JSON with a fallback (private mode, quota, bad JSON never break the page).
export const ls = {
	get<T>(k: string, fallback: T): T {
		try {
			const v = localStorage.getItem(k);
			return v == null ? fallback : (JSON.parse(v) as T);
		} catch {
			return fallback;
		}
	},
	set(k: string, v: unknown) {
		try {
			localStorage.setItem(k, JSON.stringify(v));
		} catch {}
	},
	raw: (k: string) => {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	},
	setRaw: (k: string, v: string) => {
		try {
			localStorage.setItem(k, v);
		} catch {}
	},
};
