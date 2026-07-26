import {
  clearPortalSessionCookie,
  getPortalSession,
} from "../../../portal-auth";

export async function GET(request: Request) {
  const session = await getPortalSession(request);
  if (!session) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  return Response.json(
    {
      authenticated: true,
      user: {
        id: session.userId,
        displayName: session.displayName,
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function DELETE() {
  return Response.json(
    { authenticated: false },
    {
      headers: {
        "cache-control": "no-store",
        "set-cookie": clearPortalSessionCookie(),
      },
    },
  );
}

