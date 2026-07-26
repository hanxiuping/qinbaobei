import { createPortalSessionCookie } from "../../../portal-auth";

const PORTAL_API_BASE =
  process.env.PORTAL_API_BASE?.replace(/\/+$/, "") ||
  "https://api.hltree.cloud/api/portal";

type ExchangeResult = {
  code?: number;
  message?: string;
  data?: {
    appId?: string;
    user?: {
      id?: number;
      displayName?: string;
    };
  };
};

export async function POST(request: Request) {
  let ticket = "";
  try {
    const body = (await request.json()) as { ticket?: unknown };
    ticket = typeof body.ticket === "string" ? body.ticket.trim() : "";
  } catch {
    return errorResponse("请求格式无效", 400);
  }

  if (!/^[A-Za-z0-9_-]{24,200}$/.test(ticket)) {
    return errorResponse("访问链接无效或不完整", 400);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${PORTAL_API_BASE}/access/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
      cache: "no-store",
    });
  } catch {
    return errorResponse("小程序登录服务暂时不可用，请稍后重试", 502);
  }

  let result: ExchangeResult = {};
  try {
    result = (await upstream.json()) as ExchangeResult;
  } catch {
    return errorResponse("小程序登录服务返回异常", 502);
  }

  const user = result.data?.user;
  if (
    !upstream.ok ||
    result.code !== 0 ||
    result.data?.appId !== "qinbaobei" ||
    !Number.isInteger(user?.id) ||
    typeof user?.displayName !== "string"
  ) {
    return errorResponse(result.message || "访问链接无效、已使用或已过期", upstream.status);
  }

  try {
    const cookie = await createPortalSessionCookie({
      id: user.id as number,
      displayName: user.displayName,
    });
    return Response.json(
      { user: { displayName: user.displayName } },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": cookie,
        },
      },
    );
  } catch (error) {
    console.error("Create portal session failed:", error);
    return errorResponse("站点登录尚未配置，请联系管理员", 503);
  }
}

function errorResponse(message: string, status: number) {
  const safeStatus = status >= 400 && status <= 599 ? status : 401;
  return Response.json(
    { error: "portal_exchange_failed", message },
    { status: safeStatus, headers: { "cache-control": "no-store" } },
  );
}

