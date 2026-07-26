import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import Busboy from "busboy";

const root = fileURLToPath(new URL("../", import.meta.url));
const clientRoot = join(root, "dist", "client");
const { default: worker } = await import("../dist/server/index.js");

const TOKEN_FILE = process.env.BAIDU_TOKEN_FILE || resolve(root, ".baidu_token.json");

const ENV = {};
try {
  const envPath = resolve(root, ".env");
  if (existsSync(envPath)) {
    const lines = readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)/);
      if (m) ENV[m[1]] = m[2].trim();
    }
  }
} catch { /* ignore */ }

const BaiduConfig = {
  appKey: process.env.BAIDU_APP_KEY || ENV.BAIDU_APP_KEY || "gUDfeXpmlfBLBtBFxosTOJj4vNEm9xOY",
  secretKey: process.env.BAIDU_SECRET_KEY || ENV.BAIDU_SECRET_KEY || "",
  appName: process.env.BAIDU_APP_NAME || ENV.BAIDU_APP_NAME || "亲宝贝",
};

function appDirectory(user) {
  const name = user || "小树";
  return `/apps/${BaiduConfig.appName}/${name}`;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function localAssetPath(pathname) {
  const decoded = decodeURIComponent(pathname.replace(/^\/+/, ""));
  const assetPath = normalize(join(clientRoot, decoded));
  return assetPath.startsWith(clientRoot) ? assetPath : null;
}

async function serveAsset(pathname) {
  const assetPath = localAssetPath(pathname);
  if (!assetPath) return null;

  try {
    const body = await readFile(assetPath);
    return new Response(body, {
      headers: {
        "content-type": mimeTypes[extname(assetPath)] ?? "application/octet-stream",
      },
    });
  } catch {
    return null;
  }
}

// ─── Baidu Token Helpers ────────────────────────────────────────────────

function loadToken() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const raw = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
      if (raw.accessToken) return raw;
    }
  } catch { /* ignore */ }
  return null;
}

function saveToken(token) {
  try {
    writeFileSync(TOKEN_FILE, JSON.stringify(token, null, 2), "utf-8");
  } catch { /* ignore */ }
}

async function refreshAccessToken(token) {
  if (!BaiduConfig.secretKey) throw new Error("缺少 BAIDU_SECRET_KEY");
  if (!token.refreshToken) throw new Error("缺少 refresh_token，请重新授权");

  const url = new URL("https://openapi.baidu.com/oauth/2.0/token");
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", token.refreshToken);
  url.searchParams.set("client_id", BaiduConfig.appKey);
  url.searchParams.set("client_secret", BaiduConfig.secretKey);

  const res = await fetch(url);
  const payload = await res.json();
  if (!res.ok || payload.error) {
    throw new Error(String(payload.error_description ?? payload.error ?? "刷新 token 失败"));
  }

  const expiresIn = Number(payload.expires_in ?? 2592000);
  const updated = {
    accessToken: String(payload.access_token ?? ""),
    refreshToken: String(payload.refresh_token ?? token.refreshToken),
    expiresAt: Date.now() + expiresIn * 1000,
    scope: token.scope,
  };
  saveToken(updated);
  return updated;
}

async function ensureFreshToken(token) {
  if (!token.expiresAt || token.expiresAt - Date.now() > 5 * 60 * 1000) {
    return { token, refreshed: false };
  }
  return { token: await refreshAccessToken(token), refreshed: true };
}

// ─── Baidu Upload Helpers ──────────────────────────────────────────────

const UPLOAD_CHUNK_SIZE = 4 * 1024 * 1024;

function md5Buffer(buf) {
  return createHash("md5").update(Buffer.from(buf)).digest("hex");
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function truncate(text, max = 200) {
  return text.length > max ? text.slice(0, max) + "..." : text;
}

async function ensureAppDirectory(token, user) {
  const dir = appDirectory(user);
  try {
    const dirUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    dirUrl.searchParams.set("method", "list");
    dirUrl.searchParams.set("access_token", token.accessToken);
    dirUrl.searchParams.set("dir", dir);
    dirUrl.searchParams.set("start", "0");
    dirUrl.searchParams.set("limit", "1");
    const probe = await fetch(dirUrl);
    const probeData = await probe.json();
    if (probeData.errno === 0) return;
    if (probeData.errno !== -9) return;

    const parents = dir.split("/").filter(Boolean);
    let current = "";
    for (const name of parents) {
      current += "/" + name;
      try {
        const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
        url.searchParams.set("method", "create");
        url.searchParams.set("access_token", token.accessToken);
        const body = new URLSearchParams({ path: current, isdir: "1", rtype: "0" });
        await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString(),
        });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

async function ensureDateDir(token, dirPath) {
  try {
    const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    url.searchParams.set("method", "create");
    url.searchParams.set("access_token", token.accessToken);
    const body = new URLSearchParams({ path: dirPath, isdir: "1", rtype: "1" });
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch { /* ignore */ }
}

async function precreateFile(token, path, size, md5s) {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "precreate");
  url.searchParams.set("access_token", token.accessToken);
  const body = new URLSearchParams({
    path,
    size: String(size),
    isdir: "0",
    autoinit: "1",
    block_list: JSON.stringify(md5s),
    rtype: "3",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`precreate HTTP ${res.status}: ${truncate(text)}`);
  const payload = safeParseJson(text);
  if (!payload) throw new Error(`precreate 非JSON: ${truncate(text)}`);
  if (payload.errno !== 0 && payload.errno != null) {
    throw new Error(`precreate 失败: ${payload.errmsg ?? `errno=${payload.errno}`}`);
  }
  return payload;
}

async function uploadChunkToBaidu(token, path, uploadid, partseq, chunkData) {
  const url = new URL("https://d.pcs.baidu.com/rest/2.0/pcs/superfile2");
  url.searchParams.set("method", "upload");
  url.searchParams.set("access_token", token.accessToken);
  url.searchParams.set("type", "tmpfile");
  url.searchParams.set("path", path);
  url.searchParams.set("uploadid", uploadid);
  url.searchParams.set("partseq", String(partseq));

  const formData = new FormData();
  formData.append("file", new Blob([chunkData]), path);

  const res = await fetch(url, { method: "POST", body: formData });
  const text = await res.text();
  if (!res.ok) throw new Error(`分片 ${partseq} 上传失败: HTTP ${res.status}; ${truncate(text)}`);
  const payload = safeParseJson(text);
  if (payload && payload.error_code != null && payload.error_code !== 0) {
    throw new Error(`分片 ${partseq} 失败: ${payload.error_msg ?? `code=${payload.error_code}`}`);
  }
  return payload;
}

async function createFileOnBaidu(token, path, size, uploadid, blockList) {
  const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
  url.searchParams.set("method", "create");
  url.searchParams.set("access_token", token.accessToken);
  const body = new URLSearchParams({
    path,
    size: String(size),
    isdir: "0",
    uploadid,
    block_list: JSON.stringify(blockList),
    rtype: "3",
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`create HTTP ${res.status}: ${truncate(text)}`);
  const payload = safeParseJson(text);
  if (!payload) throw new Error(`create 非JSON: ${truncate(text)}`);
  if (payload.errno !== 0 && payload.errno != null) {
    throw new Error(`create 失败: ${payload.errmsg ?? `errno=${payload.errno}`}`);
  }
  return payload;
}

// ─── Multipart Parser (Node.js level) ─────────────────────────────────

function parseMultipartNode(req, contentType) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const busboy = Busboy({ headers: { "content-type": contentType } });

    busboy.on("field", (name, value) => { fields[name] = value; });

    busboy.on("file", (_field, stream, info) => {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        const data = Buffer.concat(chunks);
        files.push({ name: info.filename, fieldName: _field, data, size: data.length });
      });
      stream.on("error", reject);
    });

    busboy.on("error", reject);
    busboy.on("finish", () => resolve({ fields, files }));

    req.pipe(busboy);
  });
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  });
  res.end(body);
}

// ─── Upload Route Interceptors ──────────────────────────────────────────

async function handleLogout(req, res) {
  try {
    if (existsSync(TOKEN_FILE)) unlinkSync(TOKEN_FILE);
  } catch { /* ignore */ }
  jsonResponse(res, { ok: true });
}

async function handleUploadInit(req, res) {
  const token = loadToken();
  if (!token?.accessToken) return jsonResponse(res, { error: "not_connected", message: "未绑定百度网盘" }, 401);

  const body = JSON.parse(await collectBody(req));
  const { filename, size, md5s, fileDate, user } = body;
  if (!filename || !size || !Array.isArray(md5s)) {
    return jsonResponse(res, { error: "bad_request", message: "缺少 filename/size/md5s" }, 400);
  }

  try {
    const { token: freshToken } = await ensureFreshToken(token);
    await ensureAppDirectory(freshToken, user);

    const refDate = fileDate ? new Date(fileDate) : new Date();
    const yyyy = String(refDate.getFullYear());
    const mm = String(refDate.getMonth() + 1).padStart(2, "0");
    const dd = String(refDate.getDate()).padStart(2, "0");
    const ts = Math.floor(refDate.getTime() / 1000);
    const ext = (filename.match(/\.[^/.]+$/) ?? [""])[0];
    const dateDir = `${appDirectory(user)}/${yyyy}-${mm}`;
    const newFilename = `${yyyy}-${mm}-${dd}-${ts}${ext}`;
    await ensureDateDir(freshToken, dateDir);

    const targetPath = `${dateDir}/${newFilename}`.replace(/\/+/g, "/");
    const precreate = await precreateFile(freshToken, targetPath, size, md5s);

    if (precreate.return_type === 2) {
      return jsonResponse(res, {
        path: targetPath,
        uploadid: String(precreate.uploadid ?? ""),
        return_type: 2,
        requiredBlocks: [],
        fsId: precreate.info?.fsid,
      });
    }

    const requiredBlocks = Array.isArray(precreate.block_list) && precreate.block_list.length
      ? precreate.block_list.map(Number)
      : md5s.map((_, idx) => idx);

    return jsonResponse(res, {
      path: targetPath,
      uploadid: String(precreate.uploadid ?? ""),
      return_type: precreate.return_type ?? 1,
      requiredBlocks,
    });
  } catch (err) {
    return jsonResponse(res, { error: "init_failed", message: err instanceof Error ? err.message : "初始化上传失败" }, 500);
  }
}

async function handleUploadChunk(req, res) {
  const token = loadToken();
  if (!token?.accessToken) return jsonResponse(res, { error: "not_connected", message: "未绑定百度网盘" }, 401);

  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonResponse(res, { error: "bad_request", message: "需要 multipart/form-data" }, 400);
  }

  let parsed;
  try {
    parsed = await parseMultipartNode(req, contentType);
  } catch (err) {
    return jsonResponse(res, { error: "parse_failed", message: err instanceof Error ? err.message : "解析失败" }, 400);
  }

  const { fields, files } = parsed;
  if (!files.length) return jsonResponse(res, { error: "no_file", message: "没有文件分片" }, 400);

  const { path: filePath, uploadid, partseq } = fields;
  if (!filePath || uploadid == null || partseq == null) {
    return jsonResponse(res, { error: "bad_request", message: "缺少 path/uploadid/partseq" }, 400);
  }

  try {
    const { token: freshToken } = await ensureFreshToken(token);
    const result = await uploadChunkToBaidu(freshToken, filePath, uploadid, Number(partseq), files[0].data);
    return jsonResponse(res, { ok: true, partseq: Number(partseq), result });
  } catch (err) {
    return jsonResponse(res, { error: "chunk_failed", message: err instanceof Error ? err.message : "分片上传失败" }, 502);
  }
}

async function handleUploadFinish(req, res) {
  const token = loadToken();
  if (!token?.accessToken) return jsonResponse(res, { error: "not_connected", message: "未绑定百度网盘" }, 401);

  const body = JSON.parse(await collectBody(req));
  const { path: filePath, size, uploadid, block_list } = body;
  if (!filePath || !size || !uploadid || !Array.isArray(block_list)) {
    return jsonResponse(res, { error: "bad_request", message: "缺少必要参数" }, 400);
  }

  try {
    const { token: freshToken } = await ensureFreshToken(token);
    const result = await createFileOnBaidu(freshToken, filePath, size, uploadid, block_list);
    return jsonResponse(res, { ok: true, path: filePath, fsId: result.fsid });
  } catch (err) {
    return jsonResponse(res, { error: "finish_failed", message: err instanceof Error ? err.message : "完成上传失败" }, 502);
  }
}

async function handleDelete(req, res) {
  const token = loadToken();
  if (!token?.accessToken) return jsonResponse(res, { error: "not_connected", message: "未绑定百度网盘" }, 401);

  const body = JSON.parse(await collectBody(req));
  const { path: filePath } = body;
  if (!filePath) return jsonResponse(res, { error: "bad_request", message: "缺少 path" }, 400);

  try {
    const { token: freshToken } = await ensureFreshToken(token);
    const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    url.searchParams.set("method", "delete");
    url.searchParams.set("access_token", freshToken.accessToken);
    const postBody = new URLSearchParams({ path: filePath });
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: postBody.toString(),
    });
    const text = await response.text();
    const payload = safeParseJson(text);
    if (payload && (payload.errno || payload.error_code)) {
      const code = payload.errno ?? payload.error_code;
      const msg = payload.errmsg ?? payload.error_msg ?? `errno=${code}`;
      throw new Error(`删除失败: ${msg}`);
    }
    return jsonResponse(res, { ok: true, path: filePath });
  } catch (err) {
    return jsonResponse(res, { error: "delete_failed", message: err instanceof Error ? err.message : "删除失败" }, 502);
  }
}

async function handleStream(req, res) {
  const token = loadToken();
  if (!token?.accessToken) return jsonResponse(res, { error: "not_connected", message: "未绑定百度网盘" }, 401);

  const target = new URL(req.url, `http://${req.headers.host}`);
  const filePath = target.searchParams.get("path");
  if (!filePath) return jsonResponse(res, { error: "bad_request", message: "缺少 path 参数" }, 400);

  try {
    const { token: freshToken } = await ensureFreshToken(token);
    const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    url.searchParams.set("method", "download");
    url.searchParams.set("access_token", freshToken.accessToken);
    url.searchParams.set("path", filePath);

    const baiduRes = await fetch(url.toString(), { redirect: "manual" });

    if (baiduRes.status === 302 || baiduRes.status === 301) {
      const location = baiduRes.headers.get("location");
      if (!location) return jsonResponse(res, { error: "no_link", message: "获取下载链接失败" }, 502);

      const fileHeaders = {};
      if (req.headers.range) fileHeaders.range = req.headers.range;

      const fileRes = await fetch(location, { headers: fileHeaders });

      const contentLength = fileRes.headers.get("content-length");
      const contentRange = fileRes.headers.get("content-range");
      const contentType = fileRes.headers.get("content-type") || "application/octet-stream";

      const headers = {
        "content-type": contentType,
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=3600",
      };
      if (contentLength) headers["content-length"] = contentLength;
      if (contentRange) headers["content-range"] = contentRange;

      const status = fileRes.status === 206 ? 206 : 200;
      res.writeHead(status, headers);

      const reader = fileRes.body?.getReader?.();
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } catch { /* stream ended */ }
        res.end();
      } else {
        const buf = Buffer.from(await fileRes.arrayBuffer());
        res.end(buf);
      }
    } else if (baiduRes.ok) {
      const contentType = baiduRes.headers.get("content-type") || "application/octet-stream";
      const contentLength = baiduRes.headers.get("content-length");
      const headers = {
        "content-type": contentType,
        "access-control-allow-origin": "*",
      };
      if (contentLength) headers["content-length"] = contentLength;
      res.writeHead(200, headers);

      const reader = baiduRes.body?.getReader?.();
      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(Buffer.from(value));
          }
        } catch { /* stream ended */ }
        res.end();
      } else {
        const buf = Buffer.from(await baiduRes.arrayBuffer());
        res.end(buf);
      }
    } else {
      const text = await baiduRes.text();
      jsonResponse(res, { error: "baidu_error", message: `百度返回 ${baiduRes.status}: ${truncate(text)}` }, 502);
    }
  } catch (err) {
    jsonResponse(res, { error: "stream_failed", message: err instanceof Error ? err.message : "视频加载失败" }, 502);
  }
}

async function handleThumbnail(req, res) {
  const token = loadToken();
  if (!token?.accessToken) return jsonResponse(res, { error: "not_connected", message: "未绑定百度网盘" }, 401);

  const target = new URL(req.url, `http://${req.headers.host}`);
  const filePath = target.searchParams.get("path");
  const size = target.searchParams.get("size") || "1024x1024";
  if (!filePath) return jsonResponse(res, { error: "bad_request", message: "缺少 path 参数" }, 400);

  try {
    const { token: freshToken } = await ensureFreshToken(token);
    const url = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    url.searchParams.set("method", "thumbnail");
    url.searchParams.set("access_token", freshToken.accessToken);
    url.searchParams.set("path", filePath);
    url.searchParams.set("size", size);
    url.searchParams.set("quality", "100");

    const baiduRes = await fetch(url.toString(), { redirect: "manual" });

    if (baiduRes.status === 302 || baiduRes.status === 301) {
      const location = baiduRes.headers.get("location");
      if (!location) return jsonResponse(res, { error: "no_link", message: "获取缩略图失败" }, 502);

      const fileRes = await fetch(location);
      const contentType = fileRes.headers.get("content-type") || "image/jpeg";
      const contentLength = fileRes.headers.get("content-length");

      const headers = { "content-type": contentType, "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" };
      if (contentLength) headers["content-length"] = contentLength;

      res.writeHead(200, headers);
      const reader = fileRes.body?.getReader?.();
      if (reader) {
        try { while (true) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } } catch { /* stream ended */ }
        res.end();
      } else {
        res.end(Buffer.from(await fileRes.arrayBuffer()));
      }
    } else if (baiduRes.ok) {
      const contentType = baiduRes.headers.get("content-type") || "image/jpeg";
      const contentLength = baiduRes.headers.get("content-length");
      const headers = { "content-type": contentType, "access-control-allow-origin": "*", "cache-control": "public, max-age=86400" };
      if (contentLength) headers["content-length"] = contentLength;
      res.writeHead(200, headers);
      const reader = baiduRes.body?.getReader?.();
      if (reader) {
        try { while (true) { const { done, value } = await reader.read(); if (done) break; res.write(Buffer.from(value)); } } catch { /* stream ended */ }
        res.end();
      } else {
        res.end(Buffer.from(await baiduRes.arrayBuffer()));
      }
    } else {
      const text = await baiduRes.text();
      jsonResponse(res, { error: "baidu_error", message: `百度返回 ${baiduRes.status}` }, 502);
    }
  } catch (err) {
    jsonResponse(res, { error: "thumbnail_failed", message: err instanceof Error ? err.message : "缩略图加载失败" }, 502);
  }
}

// ─── HTTP Server ────────────────────────────────────────────────────────

async function toFetchRequest(req) {
  const host = req.headers.host ?? "127.0.0.1:4173";
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value != null) {
      headers.set(key, value);
    }
  }

  if (req.method === "GET" || req.method === "HEAD") {
    return new Request(url, { method: req.method, headers });
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  return new Request(url, { method: req.method, headers, body });
}

const INTERCEPT_ROUTES = {
  "POST /api/baidu/upload/init": handleUploadInit,
  "POST /api/baidu/upload/chunk": handleUploadChunk,
  "POST /api/baidu/upload/finish": handleUploadFinish,
  "DELETE /api/baidu/delete": handleDelete,
  "POST /api/baidu/logout": handleLogout,
};

function isInterceptRoute(method, pathname) {
  return INTERCEPT_ROUTES[`${method} ${pathname}`];
}

const server = createServer(async (nodeReq, nodeRes) => {
  try {
    const target = new URL(nodeReq.url ?? "/", `http://${nodeReq.headers.host}`);

    if (isInterceptRoute(nodeReq.method, target.pathname)) {
      return await INTERCEPT_ROUTES[`${nodeReq.method} ${target.pathname}`](nodeReq, nodeRes);
    }

    if (nodeReq.method === "GET" && target.pathname === "/api/baidu/stream") {
      return await handleStream(nodeReq, nodeRes);
    }

    if (nodeReq.method === "GET" && target.pathname === "/api/baidu/thumbnail") {
      return await handleThumbnail(nodeReq, nodeRes);
    }

    const asset = await serveAsset(target.pathname);
    const rendered =
      asset ??
      (await worker.fetch(await toFetchRequest(nodeReq),
        {
          ASSETS: {
            fetch: async (assetRequest) => serveAsset(new URL(assetRequest.url).pathname) ?? new Response("Not found", { status: 404 }),
          },
        },
        {
          waitUntil() {},
          passThroughOnException() {},
        },
      ));

    nodeRes.writeHead(rendered.status, Object.fromEntries(rendered.headers));
    nodeRes.end(Buffer.from(await rendered.arrayBuffer()));
  } catch (error) {
    console.error("[upload-proxy] Error:", error);
    nodeRes.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    nodeRes.end(error instanceof Error ? error.stack : String(error));
  }
});

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
server.listen(port, host, () => {
  console.log(`Local preview: http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`);
});
