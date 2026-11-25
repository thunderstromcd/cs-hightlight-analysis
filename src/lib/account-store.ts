import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Account = { id: string; username: string; role: "admin" | "member"; preferredSteamId: string | null };
export type LibraryEntry = {
  id: string;
  assetId: string;
  createdAt: string;
  bindingState: "pending" | "selected" | "skipped";
  steamId: string | null;
};
export type ExportOwnership = {
  ownerId: string;
  entryId: string;
  originalName: string;
  mapName: string | null;
};

const databases = globalThis as typeof globalThis & { chaipianDatabases?: Map<string, DatabaseSync> };
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_WINDOW = 15 * 60 * 1000;

export function dataDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR || "data");
}

function db(): DatabaseSync {
  const root = dataDir();
  const cache = databases.chaipianDatabases ??= new Map();
  const existing = cache.get(root);
  if (existing) return existing;
  mkdirSync(root, { recursive: true });
  const database = new DatabaseSync(path.join(root, "accounts.sqlite"));
  database.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
      preferredSteamId TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      hash TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES accounts(id),
      expiresAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(userId);
    CREATE TABLE IF NOT EXISTS login_limits (
      key TEXT PRIMARY KEY,
      attempts INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS library_entries (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES accounts(id),
      assetId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      bindingState TEXT NOT NULL DEFAULT 'pending' CHECK (bindingState IN ('pending', 'selected', 'skipped')),
      steamId TEXT,
      UNIQUE (ownerId, assetId)
    );
    CREATE INDEX IF NOT EXISTS library_owner_date ON library_entries(ownerId, createdAt DESC);
    CREATE TABLE IF NOT EXISTS legacy_exports (
      id TEXT PRIMARY KEY,
      ownerId TEXT NOT NULL REFERENCES accounts(id),
      entryId TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mapName TEXT
    );
  `);
  cache.set(root, database);
  return database;
}

export function closeAccountDatabase() {
  const root = dataDir();
  databases.chaipianDatabases?.get(root)?.close();
  databases.chaipianDatabases?.delete(root);
}

function transaction<T>(work: (database: DatabaseSync) => T): T {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = work(database);
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export class AccountError extends Error {}

function loginKey(username: string) {
  return username.trim().normalize("NFKC").toLowerCase();
}

function validateCredentials(username: string, password: string) {
  if (!loginKey(username) || username.trim().length > 40) throw new AccountError("用户名长度应为 1 到 40 个字符。");
  if (!password || password.length > 128) throw new AccountError("密码长度应为 1 到 128 个字符。");
}

function derivePassword(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}:${(await derivePassword(password, salt)).toString("hex")}`;
}

async function verifyPassword(password: string, encoded?: string): Promise<boolean> {
  const [salt, hash] = encoded?.split(":") ?? ["0".repeat(32), "0".repeat(128)];
  const derived = await derivePassword(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(derived, Buffer.from(hash, "hex")) && Boolean(encoded);
}

export function hasAccounts(): boolean {
  return Boolean(db().prepare("SELECT 1 FROM accounts LIMIT 1").get());
}

function accountRecord(account: Account) {
  return { id: account.id, username: account.username, role: account.role, preferredSteamId: account.preferredSteamId };
}

function insertAccount(database: DatabaseSync, username: string, password: string, role: Account["role"]): Account {
  const key = loginKey(username);
  if (database.prepare("SELECT 1 FROM accounts WHERE login = ?").get(key)) throw new AccountError("这个用户名已存在。");
  const account = { id: randomUUID(), username: username.trim(), role, preferredSteamId: null };
  database.prepare("INSERT INTO accounts (id, username, login, password, role) VALUES (?, ?, ?, ?, ?)")
    .run(account.id, account.username, key, password, role);
  return account;
}

export async function createMember(username: string, password: string): Promise<Account> {
  validateCredentials(username, password);
  const hash = await hashPassword(password);
  return transaction((database) => insertAccount(database, username, hash, "member"));
}

export async function bootstrapAdmin(
  username: string,
  password: string,
  beforeCreate: () => Promise<{
    entries: Array<{ id: string; createdAt: string }>;
    exports: Array<Omit<ExportOwnership, "ownerId"> & { id: string }>;
  }>,
): Promise<Account> {
  validateCredentials(username, password);
  if (hasAccounts()) throw new AccountError("首个管理员已经创建。");
  const hash = await hashPassword(password);
  const legacy = await beforeCreate();
  return transaction((database) => {
    if (hasAccounts()) throw new AccountError("首个管理员已经创建。");
    const admin = insertAccount(database, username, hash, "admin");
    const addEntry = database.prepare("INSERT INTO library_entries (id, ownerId, assetId, createdAt) VALUES (?, ?, ?, ?)");
    for (const item of legacy.entries) addEntry.run(item.id, admin.id, item.id, item.createdAt);
    const addExport = database.prepare("INSERT INTO legacy_exports (id, ownerId, entryId, originalName, mapName) VALUES (?, ?, ?, ?, ?)");
    for (const item of legacy.exports) addExport.run(item.id, admin.id, item.entryId, item.originalName, item.mapName);
    return admin;
  });
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSession(userId: string): string {
  const token = randomBytes(32).toString("hex");
  db().prepare("DELETE FROM sessions WHERE expiresAt <= ?").run(Date.now());
  db().prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(hashToken(token), userId, Date.now() + SESSION_MS);
  return token;
}

export function sessionAccount(token?: string): Account | null {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return db().prepare(`
    SELECT a.id, a.username, a.role, a.preferredSteamId FROM sessions s JOIN accounts a ON a.id = s.userId
    WHERE s.hash = ? AND s.expiresAt > ?
  `).get(hashToken(token), Date.now()) as Account | undefined ?? null;
}

export function endSession(token?: string) {
  if (token) db().prepare("DELETE FROM sessions WHERE hash = ?").run(hashToken(token));
}

export const SESSION_MAX_AGE = SESSION_MS / 1000;

export async function authenticate(username: string, password: string, address: string) {
  validateCredentials(username, password);
  const key = loginKey(username);
  const database = db();
  const now = Date.now();
  const scopes = [{ key: `user:${key}`, max: 8 }, { key: `address:${address}`, max: 30 }];
  const allowed = transaction((sqlite) => {
    sqlite.prepare("DELETE FROM login_limits WHERE expiresAt <= ?").run(now);
    const count = sqlite.prepare("SELECT attempts FROM login_limits WHERE key = ?");
    if (scopes.some((scope) => ((count.get(scope.key)?.attempts as number | undefined) ?? 0) >= scope.max)) return false;
    const bump = sqlite.prepare(`
      INSERT INTO login_limits VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET attempts = attempts + 1
    `);
    for (const scope of scopes) bump.run(scope.key, now + LOGIN_WINDOW);
    return true;
  });
  if (!allowed) return { limited: true as const };
  const stored = database.prepare("SELECT * FROM accounts WHERE login = ?").get(key) as (Account & { password: string }) | undefined;
  if (!await verifyPassword(password, stored?.password) || !stored) return { limited: false as const, account: null };
  return transaction((sqlite) => {
    // A password may have just changed while scrypt was running.
    if (!sqlite.prepare("SELECT 1 FROM accounts WHERE id = ? AND password = ?").get(stored.id, stored.password)) {
      return { limited: false as const, account: null };
    }
    sqlite.prepare("DELETE FROM login_limits WHERE key = ?").run(scopes[0].key);
    return { limited: false as const, account: accountRecord(stored), token: newSession(stored.id) };
  });
}

export async function changePassword(user: Account, current: string, next: string): Promise<boolean> {
  validateCredentials(user.username, current);
  validateCredentials(user.username, next);
  const old = db().prepare("SELECT password FROM accounts WHERE id = ?").get(user.id)?.password as string | undefined;
  if (!await verifyPassword(current, old) || !old) return false;
  const update = await hashPassword(next);
  return transaction((database) => {
    const result = database.prepare("UPDATE accounts SET password = ? WHERE id = ? AND password = ?").run(update, user.id, old);
    if (!result.changes) return false;
    database.prepare("DELETE FROM sessions WHERE userId = ?").run(user.id);
    return true;
  });
}

export function addLibraryEntry(ownerId: string, assetId: string): { entry: LibraryEntry; added: boolean } {
  const database = db();
  const add = database.prepare(`
    INSERT INTO library_entries (id, ownerId, assetId, createdAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(ownerId, assetId) DO NOTHING
  `).run(randomUUID(), ownerId, assetId, new Date().toISOString());
  const entry = database.prepare("SELECT * FROM library_entries WHERE ownerId = ? AND assetId = ?").get(ownerId, assetId) as LibraryEntry;
  return { entry, added: Boolean(add.changes) };
}

export function listLibrary(ownerId: string, limit = -1): LibraryEntry[] {
  return db().prepare("SELECT * FROM library_entries WHERE ownerId = ? ORDER BY createdAt DESC, rowid DESC LIMIT ?")
    .all(ownerId, limit) as LibraryEntry[];
}

export function readLibraryEntry(ownerId: string, id: string): LibraryEntry | null {
  return db().prepare("SELECT * FROM library_entries WHERE ownerId = ? AND id = ?").get(ownerId, id) as LibraryEntry | undefined ?? null;
}

export function removeLibraryEntry(ownerId: string, id: string) {
  return Boolean(db().prepare("DELETE FROM library_entries WHERE ownerId = ? AND id = ?").run(ownerId, id).changes);
}

export function bindLibraryPlayer(ownerId: string, id: string, steamId: string | null, makePreferred: boolean, automatic = false) {
  return transaction((database) => {
    const entry = readLibraryEntry(ownerId, id);
    if (!entry || (automatic && entry.bindingState !== "pending")) return entry;
    database.prepare("UPDATE library_entries SET bindingState = ?, steamId = ? WHERE id = ? AND ownerId = ?")
      .run(steamId ? "selected" : "skipped", steamId, id, ownerId);
    if (steamId && !automatic) {
      database.prepare("UPDATE accounts SET preferredSteamId = ? WHERE id = ? AND (preferredSteamId IS NULL OR ? = 1)")
        .run(steamId, ownerId, Number(makePreferred));
    }
    return readLibraryEntry(ownerId, id);
  });
}

export function legacyExportOwnership(id: string): ExportOwnership | undefined {
  return db().prepare("SELECT ownerId, entryId, originalName, mapName FROM legacy_exports WHERE id = ?").get(id) as ExportOwnership | undefined;
}
