import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const TOKEN_COOKIE = "qinbaobei_baidu_token";
const STATE_COOKIE = "qinbaobei_baidu_state";
const ONE_HOUR = 60 * 60;
const THIRTY_DAYS = 30 * 24 * ONE_HOUR;

const TOKEN_FILE = process.env.BAIDU_TOKEN_FILE
  ? resolve(process.env.BAIDU_TOKEN_FILE)
  : resolve(process.cwd(), ".baidu_token.json");

const STATE_FILE = process.env.BAIDU_STATE_FILE
  ? resolve(process.env.BAIDU_STATE_FILE)
  : resolve(process.cwd(), ".baidu_state.json");

export function saveState(state: string): void {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({ state, ts: Date.now() }, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

export function verifyState(state: string): boolean {
  try {
    if (!existsSync(STATE_FILE)) return false;
    const raw = JSON.parse(readFileSync(STATE_FILE, "utf-8")) as { state?: string; ts?: number };
    if (!raw.state || raw.state !== state) return false;
    if (raw.ts && Date.now() - raw.ts > 10 * 60 * 1000) return false; // 10分钟过期
    unlinkSync(STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

export type BaiduToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
};

function loadStoredTokenFromFile(): BaiduToken | null {
  // 1) 文件落盘的 token (一次授权、永久托管)
  try {
    if (existsSync(TOKEN_FILE)) {
      const raw = JSON.parse(readFileSync(TOKEN_FILE, "utf-8")) as Partial<BaiduToken>;
      if (raw.accessToken) {
        return {
          accessToken: String(raw.accessToken),
          refreshToken: raw.refreshToken ? String(raw.refreshToken) : undefined,
          expiresAt: raw.expiresAt ? Number(raw.expiresAt) : undefined,
          scope: raw.scope ? String(raw.scope) : undefined,
        };
      }
    }
  } catch {
    /* 文件读取失败时静默回退 */
  }
  // 2) 环境变量直接配置 (高级用户: 手动覆盖 access_token / refresh_token)
  const envAccess = process.env.BAIDU_ACCESS_TOKEN;
  if (envAccess) {
    return {
      accessToken: envAccess,
      refreshToken: process.env.BAIDU_REFRESH_TOKEN || undefined,
      expiresAt: process.env.BAIDU_TOKEN_EXPIRES_AT ? Number(process.env.BAIDU_TOKEN_EXPIRES_AT) : undefined,
      scope: process.env.BAIDU_SCOPE || undefined,
    };
  }
  return null;
}

export function saveStoredToken(token: BaiduToken): void {
  try {
    writeFileSync(
      TOKEN_FILE,
      JSON.stringify(
        {
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          scope: token.scope,
        },
        null,
        2,
      ),
      "utf-8",
    );
  } catch {
    /* 落盘失败不影响主流程 */
  }
}

export function clearStoredToken(): void {
  try {
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  } catch {
    /* ignore */
  }
}

export function isBackendBound(): boolean {
  return loadStoredTokenFromFile() != null;
}

export type BaiduFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  mtime: number;
  kind: "photo" | "video" | "file";
  thumbnail?: string;
  dlink?: string;
};

export const baiduConfig = {
  appKey: process.env.BAIDU_APP_KEY ?? "gUDfeXpmlfBLBtBFxosTOJj4vNEm9xOY",
  secretKey: process.env.BAIDU_SECRET_KEY ?? "",
  redirectUri:
    process.env.BAIDU_REDIRECT_URI ?? "https://hltree.cloud/api/baidu/callback",
  appName: process.env.BAIDU_APP_NAME ?? "亲宝贝",
  scope: process.env.BAIDU_SCOPE ?? "basic,netdisk",
};

export function appDirectory(user?: string) {
  const name = user || "小树";
  return `/apps/${baiduConfig.appName}/${name}`;
}

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init?.headers,
    },
  });
}

export function readCookie(request: Request, name: string) {
  const cookie = request.headers.get("cookie") ?? "";
  const item = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}

export function readToken(request: Request): BaiduToken | null {
  // 优先: 浏览器 cookie (兼容历史已绑定设备)
  const value = readCookie(request, TOKEN_COOKIE);
  if (value) {
    try {
      const token = JSON.parse(fromBase64Url(value)) as BaiduToken;
      if (token?.accessToken) return token;
    } catch {
      /* 解析失败时回退 */
    }
  }
  // 回退: 服务端托管 token (一次授权永久生效)
  return loadStoredTokenFromFile();
}

export function tokenCookie(token: BaiduToken) {
  return serializeCookie(TOKEN_COOKIE, toBase64Url(JSON.stringify(token)), {
    httpOnly: true,
    maxAge: THIRTY_DAYS,
    path: "/",
    sameSite: "Lax",
    secure: baiduConfig.redirectUri.startsWith("https://"),
  });
}

export function clearTokenCookie() {
  return serializeCookie(TOKEN_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: baiduConfig.redirectUri.startsWith("https://"),
  });
}

export function stateCookie(state: string) {
  return serializeCookie(STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: 10 * 60,
    path: "/",
    sameSite: "Lax",
    secure: baiduConfig.redirectUri.startsWith("https://"),
  });
}

export function clearStateCookie() {
  return serializeCookie(STATE_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "Lax",
    secure: baiduConfig.redirectUri.startsWith("https://"),
  });
}

export async function exchangeCodeForToken(code: string): Promise<BaiduToken> {
  assertSecretKey();

  const url = new URL("https://openapi.baidu.com/oauth/2.0/token");
  url.searchParams.set("grant_type", "authorization_code");
  url.searchParams.set("code", code);
  url.searchParams.set("client_id", baiduConfig.appKey);
  url.searchParams.set("client_secret", baiduConfig.secretKey);
  url.searchParams.set("redirect_uri", baiduConfig.redirectUri);

  const response = await fetch(url);
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.error) {
    throw new Error(String(payload.error_description ?? payload.error ?? "百度授权换取 token 失败"));
  }

  return normalizeToken(payload);
}

export async function refreshToken(token: BaiduToken): Promise<BaiduToken> {
  assertSecretKey();
  if (!token.refreshToken) throw new Error("缺少 refresh_token，请重新绑定百度网盘");

  const url = new URL("https://openapi.baidu.com/oauth/2.0/token");
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", token.refreshToken);
  url.searchParams.set("client_id", baiduConfig.appKey);
  url.searchParams.set("client_secret", baiduConfig.secretKey);

  const response = await fetch(url);
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || payload.error) {
    throw new Error(String(payload.error_description ?? payload.error ?? "刷新百度 token 失败"));
  }

  return normalizeToken(payload, token.refreshToken);
}

export async function ensureFreshToken(token: BaiduToken) {
  if (!token.expiresAt || token.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { token, refreshed: false };
  }
  return { token: await refreshToken(token), refreshed: true };
}

const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;

async function md5Buffer(buf: ArrayBuffer): Promise<string> {
  const buffer = Buffer.from(buf);
  const { createHash } = await import("node:crypto");
  return createHash("md5").update(buffer).digest("hex");
}

export async function uploadBaiduFile(
  token: BaiduToken,
  file: { name: string; data: ArrayBuffer; size: number },
): Promise<{ path: string; fsId?: string; uploadid?: string }> {
  await ensureAppDirectory(token); // 自动创建 /apps/亲宝贝 目录
  const targetPath = `${appDirectory()}/${file.name}`.replace(/\/+/g, "/");

  const chunks: ArrayBuffer[] = [];
  const blockList: string[] = [];
  const view = new Uint8Array(file.data);
  for (let offset = 0; offset < view.length; offset += UPLOAD_CHUNK_SIZE) {
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, view.length);
    const chunk = view.slice(offset, end).buffer;
    chunks.push(chunk);
    blockList.push(await md5Buffer(chunk));
  }

  const precreate = await precreateFile(token, targetPath, file.size, blockList);
  const uploadid = String(precreate.uploadid ?? "");
  if (precreate.return_type === 2) {
    return { path: targetPath, uploadid, fsId: precreate.info?.fsid };
  }

  const requiredBlocks: number[] =
    Array.isArray(precreate.block_list) && precreate.block_list.length
      ? precreate.block_list.map(Number)
      : blockList.map((_, idx) => idx);

  for (const partseq of requiredBlocks) {
    await uploadChunk(token, targetPath, uploadid, partseq, chunks[partseq]);
  }

  const createResult = await createFile(token, targetPath, file.size, uploadid, blockList);

  return { path: targetPath, uploadid, fsId: createResult.fsid ?? precreate.info?.fsid };


}

type PrecreateResponse = {
  uploadid?: string;
  block_list?: unknown[];
  return_type?: number;
  info?: { fsid?: string };
  errno?: number;
  errmsg?: string;
};

async function precreateFile(
  token: BaiduToken,
  path: string,
  size: number,
  blockList: string[],
): Promise<PrecreateResponse> {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "precreate");
  url.searchParams.set("access_token", token.accessToken);
  const body = new URLSearchParams({
    path,
    size: String(size),
    isdir: "0",
    autoinit: "1",
    "block_list": JSON.stringify(blockList),
    rtype: "3",
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok) throw baiduApiError("precreate", text, response.status);
  const payload = safeParseJson(text) as PrecreateResponse | null;
  if (!payload) throw new Error(`precreate 返回非JSON: ${truncate(text)}`);
  if (payload.errno !== 0 && payload.errno != null) {
    throw new Error(
      `precreate 失败: ${payload.errmsg ?? `errno=${payload.errno ?? response.status}`}; 请确认应用已开通网盘上传权限（需到百度网盘开放平台后台申请）`,
    );
  }
  return payload;
}

async function uploadChunk(
  token: BaiduToken,
  path: string,
  uploadid: string,
  partseq: number,
  chunk: ArrayBuffer,
) {
  const url = new URL("https://d.pcs.baidu.com/rest/2.0/pcs/superfile2");
  url.searchParams.set("method", "upload");
  url.searchParams.set("access_token", token.accessToken);
  url.searchParams.set("type", "tmpfile");
  url.searchParams.set("path", path);
  url.searchParams.set("uploadid", uploadid);
  url.searchParams.set("partseq", String(partseq));

  const formData = new FormData();
  formData.append("file", new Blob([chunk]), path);

  const response = await fetch(url, { method: "POST", body: formData });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`分片 ${partseq} 上传失败: HTTP ${response.status}; ${truncate(text)}`);
  }
  const payload = safeParseJson(text);
  if (!payload) {
    // d.pcs 成功时偶尔回非 JSON 头(`@pcs.baidu.com` 之类)，仅当HTTP 200时视为成功
    return;
  }
  if (payload.error_code != null && payload.error_code !== 0) {
    throw new Error(`分片 ${partseq} 上传失败: ${payload.error_msg ?? `code=${payload.error_code}`}`);
  }
}

function safeParseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function truncate(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

function baiduApiError(stage: string, text: string, status: number): Error {
  const parsed = safeParseJson(text);
  if (parsed) {
    const errno = parsed.errno ?? parsed.error_code;
    const errmsg = (parsed.errmsg ?? parsed.error_msg ?? "") as string;
    return new Error(`${stage} 失败: ${errmsg || `errno=${errno ?? status}`}`);
  }
  return new Error(`${stage} 返回非JSON: HTTP ${status}; ${truncate(text)}`);
}

type CreateResponse = { fsid?: string; errno?: number; errmsg?: string };
async function createFile(
  token: BaiduToken,
  path: string,
  size: number,
  uploadid: string,
  blockList: string[],
): Promise<CreateResponse> {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "create");
  url.searchParams.set("access_token", token.accessToken);
  const body = new URLSearchParams({
    path,
    size: String(size),
    isdir: "0",
    uploadid,
    "block_list": JSON.stringify(blockList),
    rtype: "3",
  });
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok) throw baiduApiError("create", text, response.status);
  const payload = safeParseJson(text) as { fsid?: string; errno?: number; errmsg?: string } | null;
  if (!payload) throw new Error(`create 返回非JSON: ${truncate(text)}`);
  if (payload.errno !== 0 && payload.errno != null) {
    throw new Error(`create 失败: ${payload.errmsg ?? `errno=${payload.errno ?? response.status}`}`);
  }
  return payload;
}

export async function listBaiduDateFolders(token: BaiduToken, user?: string): Promise<string[]> {
  const baseDir = appDirectory(user);
  const months = await listDirNames(token, baseDir);
  return months.filter((m) => /^\d{4}-\d{2}$/.test(m)).sort((a, b) => b.localeCompare(a));
}

export async function listBaiduFilesByDate(token: BaiduToken, monthDir: string, user?: string): Promise<BaiduFile[]> {
  const dir = `${appDirectory(user)}/${monthDir}`;
  const files: BaiduFile[] = [];
  await listDirFiles(token, dir, files);
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

async function listDirNames(token: BaiduToken, dir: string): Promise<string[]> {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "list");
  url.searchParams.set("access_token", token.accessToken);
  url.searchParams.set("dir", dir);
  url.searchParams.set("order", "time");
  url.searchParams.set("desc", "1");
  url.searchParams.set("start", "0");
  url.searchParams.set("limit", "1000");
  url.searchParams.set("web", "1");

  const response = await fetch(url);
  const payload = (await response.json()) as {
    errno?: number;
    list?: Array<Record<string, unknown>>;
  };
  if (payload.errno === -9 || !response.ok || (payload.errno && payload.errno !== 0)) return [];
  return (payload.list ?? [])
    .filter((item) => Number(item.isdir ?? 0) === 1)
    .map((item) => {
      const p = String(item.path ?? "");
      return p.split("/").pop() ?? "";
    })
    .filter(Boolean);
}

async function listDirFiles(token: BaiduToken, dir: string, files: BaiduFile[]): Promise<void> {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "list");
  url.searchParams.set("access_token", token.accessToken);
  url.searchParams.set("dir", dir);
  url.searchParams.set("order", "time");
  url.searchParams.set("desc", "1");
  url.searchParams.set("start", "0");
  url.searchParams.set("limit", "1000");
  url.searchParams.set("web", "1");

  const response = await fetch(url);
  const payload = (await response.json()) as {
    errno?: number;
    list?: Array<Record<string, unknown>>;
  };
  if (payload.errno === -9 || !response.ok || (payload.errno && payload.errno !== 0)) return;

  for (const item of payload.list ?? []) {
    if (Number(item.isdir ?? 0) === 1) continue;
    files.push(normalizeFile(item));
  }
}

async function listDirRecursive(token: BaiduToken, dir: string, files: BaiduFile[]): Promise<void> {
  await listDirFiles(token, dir, files);
  const subDirs = await listDirNames(token, dir);
  for (const sub of subDirs) {
    await listDirRecursive(token, `${dir}/${sub}`, files);
  }
}

async function ensureAppDirectory(token: BaiduToken): Promise<void> {
  try {
    const dirUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    dirUrl.searchParams.set("method", "list");
    dirUrl.searchParams.set("access_token", token.accessToken);
    dirUrl.searchParams.set("dir", appDirectory());
    dirUrl.searchParams.set("start", "0");
    dirUrl.searchParams.set("limit", "1");
    const probe = await fetch(dirUrl);
    const probeData = (await probe.json()) as { errno?: number };
    if (probeData.errno === 0) return; // 目录存在
    if (probeData.errno !== -9) return; // 其它错误先放行，让后续 precreate 自然报错

    // 目录不存在 - 用 list 在根下逐级创建
    const parents = appDirectory().split("/").filter(Boolean); // ['apps', '亲宝贝']
    let current = "";
    for (const name of parents) {
      current += "/" + name;
      await createDirectory(token, current);
    }
  } catch {
    // 静默忽略，让上传流程自己报错
  }
}

async function createDirectory(token: BaiduToken, path: string): Promise<void> {
  try {
    const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    url.searchParams.set("method", "create");
    url.searchParams.set("access_token", token.accessToken);
    const body = new URLSearchParams({ path, isdir: "1", rtype: "0" });
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    // 检查结果 - 即使已存在也算成功
    await response.json();
  } catch {
    /* ignore */
  }
}

function normalizeToken(payload: Record<string, unknown>, fallbackRefreshToken?: string): BaiduToken {
  const expiresIn = Number(payload.expires_in ?? THIRTY_DAYS);
  return {
    accessToken: String(payload.access_token ?? ""),
    refreshToken: String(payload.refresh_token ?? fallbackRefreshToken ?? ""),
    expiresAt: Date.now() + expiresIn * 1000,
    scope: typeof payload.scope === "string" ? payload.scope : undefined,
  };
}

function normalizeFile(item: Record<string, unknown>): BaiduFile {
  const name = String(item.server_filename ?? item.filename ?? "未命名文件");
  const thumbs = item.thumbs && typeof item.thumbs === "object" ? (item.thumbs as Record<string, unknown>) : {};
  const category = Number(item.category ?? 0);
  return {
    id: String(item.fs_id ?? item.md5 ?? item.path ?? name),
    name,
    path: String(item.path ?? ""),
    size: Number(item.size ?? 0),
    mtime: Number(item.server_mtime ?? item.local_mtime ?? item.local_ctime ?? 0),
    kind: fileKind(name, category),
    thumbnail: firstString(thumbs.url3, thumbs.url2, thumbs.url1, item.thumburl),
    dlink: firstString(item.dlink),
  };
}

function fileKind(name: string, category: number): "photo" | "video" | "file" {
  const lower = name.toLowerCase();
  if (category === 1 || /\.(mp4|mov|m4v|avi|mkv|webm)$/.test(lower)) return "video";
  if (category === 3 || /\.(jpg|jpeg|png|gif|webp|heic|bmp)$/.test(lower)) return "photo";
  return "file";
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value) return value;
  }
  return undefined;
}

function assertSecretKey() {
  if (!baiduConfig.secretKey) {
    throw new Error("缺少 BAIDU_SECRET_KEY。请把百度开放平台 Secret Key 配到服务端环境变量。");
  }
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: "Lax" | "Strict" | "None";
    secure?: boolean;
  },
) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
