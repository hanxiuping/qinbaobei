import {
  ensureFreshToken,
  jsonResponse,
  readToken,
  tokenCookie,
} from "../_lib";
import { requirePortalSession } from "../../../portal-auth";

export async function GET(request: Request) {
  const denied = await requirePortalSession(request);
  if (denied) return denied;

  const savedToken = readToken(request);
  if (!savedToken?.accessToken) {
    return jsonResponse(
      { error: "not_connected", message: "请先绑定百度网盘账号。" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const filePath = url.searchParams.get("path");
  const size = url.searchParams.get("size") || "1024";
  if (!filePath) {
    return jsonResponse(
      { error: "bad_request", message: "缺少 path 参数" },
      { status: 400 },
    );
  }

  try {
    const { token, refreshed } = await ensureFreshToken(savedToken);

    const thumbUrl = new URL("https://pan.baidu.com/rest/2.0/xpan/file");
    thumbUrl.searchParams.set("method", "thumbnail");
    thumbUrl.searchParams.set("access_token", token.accessToken);
    thumbUrl.searchParams.set("path", filePath);
    thumbUrl.searchParams.set("size", size);
    thumbUrl.searchParams.set("quality", "100");

    const baiduRes = await fetch(thumbUrl.toString(), { redirect: "manual" });

    if (baiduRes.status === 302 || baiduRes.status === 301) {
      const location = baiduRes.headers.get("location");
      if (!location) {
        return jsonResponse(
          { error: "no_link", message: "获取缩略图失败" },
          { status: 502 },
        );
      }
      const fileRes = await fetch(location);
      const contentType = fileRes.headers.get("content-type") || "image/jpeg";
      const contentLength = fileRes.headers.get("content-length");
      const headers: Record<string, string> = {
        "content-type": contentType,
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=86400",
      };
      if (contentLength) headers["content-length"] = contentLength;

      const response = new Response(fileRes.body, { status: 200, headers });
      if (refreshed) response.headers.append("set-cookie", tokenCookie(token));
      return response;
    }

    if (baiduRes.ok) {
      const contentType = baiduRes.headers.get("content-type") || "image/jpeg";
      const contentLength = baiduRes.headers.get("content-length");
      const headers: Record<string, string> = {
        "content-type": contentType,
        "access-control-allow-origin": "*",
        "cache-control": "public, max-age=86400",
      };
      if (contentLength) headers["content-length"] = contentLength;
      return new Response(baiduRes.body, { status: 200, headers });
    }

    const text = await baiduRes.text();
    return jsonResponse(
      { error: "baidu_api_error", message: text.slice(0, 200) },
      { status: 502 },
    );
  } catch (caught) {
    return jsonResponse(
      {
        error: "thumbnail_failed",
        message: caught instanceof Error ? caught.message : "获取缩略图失败",
      },
      { status: 502 },
    );
  }
}
