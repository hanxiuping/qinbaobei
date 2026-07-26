import {
  ensureFreshToken,
  jsonResponse,
  listBaiduDateFolders,
  listBaiduFilesByDate,
  readToken,
  tokenCookie,
} from "../_lib";

export async function GET(request: Request) {
  const savedToken = readToken(request);
  if (!savedToken?.accessToken) {
    return jsonResponse(
      { error: "not_connected", message: "请先绑定百度网盘账号。" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const datePath = url.searchParams.get("date");
  const user = url.searchParams.get("user") || "小树";

  try {
    const { token, refreshed } = await ensureFreshToken(savedToken);

    if (datePath) {
      const files = await listBaiduFilesByDate(token, datePath, user);
      const response = jsonResponse({ files });
      if (refreshed) response.headers.append("set-cookie", tokenCookie(token));
      return response;
    }

    const dates = await listBaiduDateFolders(token, user);
    const response = jsonResponse({ dates });
    if (refreshed) response.headers.append("set-cookie", tokenCookie(token));
    return response;
  } catch (caught) {
    return jsonResponse(
      {
        error: "baidu_files_failed",
        message: caught instanceof Error ? caught.message : "读取百度网盘文件失败",
      },
      { status: 502 },
    );
  }
}
