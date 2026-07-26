import { appDirectory, baiduConfig, isBackendBound, jsonResponse, readToken } from "../_lib";

export async function GET(request: Request) {
  const token = readToken(request);
  return jsonResponse({
    appKey: baiduConfig.appKey,
    appName: baiduConfig.appName,
    appDirectory: appDirectory(),
    configured: Boolean(baiduConfig.appKey && baiduConfig.redirectUri),
    connected: Boolean(token?.accessToken),
    backendBound: isBackendBound(),
    hasSecretKey: Boolean(baiduConfig.secretKey),
    redirectUri: baiduConfig.redirectUri,
    scope: token?.scope ?? baiduConfig.scope,
  });
}
