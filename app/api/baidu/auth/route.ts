import { baiduConfig, saveState } from "../_lib";

export async function GET() {
  const state = crypto.randomUUID();
  saveState(state); // 服务端文件存储 state，不依赖浏览器 cookie
  const url = new URL("https://openapi.baidu.com/oauth/2.0/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", baiduConfig.appKey);
  url.searchParams.set("redirect_uri", baiduConfig.redirectUri);
  url.searchParams.set("scope", baiduConfig.scope);
  url.searchParams.set("state", state);

  return new Response(null, {
    status: 302,
    headers: {
      location: url.toString(),
    },
  });
}
