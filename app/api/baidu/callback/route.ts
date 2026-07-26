import {
  exchangeCodeForToken,
  saveStoredToken,
  verifyState,
} from "../_lib";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const state = url.searchParams.get("state");
  const redirect = new URL("/", url.origin);

  if (error) {
    redirect.searchParams.set("baidu", "denied");
    redirect.searchParams.set("message", error);
    return redirectResponse(redirect);
  }

  if (!code) {
    redirect.searchParams.set("baidu", "missing_code");
    return redirectResponse(redirect);
  }

  if (!state || !verifyState(state)) {
    redirect.searchParams.set("baidu", "bad_state");
    return redirectResponse(redirect);
  }

  try {
    const token = await exchangeCodeForToken(code);
    saveStoredToken(token); // 落盘到服务端，一次授权永久托管
    redirect.searchParams.set("baidu", "connected");
    return redirectResponse(redirect);
  } catch (caught) {
    redirect.searchParams.set("baidu", "failed");
    redirect.searchParams.set(
      "message",
      caught instanceof Error ? caught.message : "百度授权失败",
    );
    return redirectResponse(redirect);
  }
}

function redirectResponse(url: URL) {
  return new Response(null, { status: 302, headers: { location: url.toString() } });
}
