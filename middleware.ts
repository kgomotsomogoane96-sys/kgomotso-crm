import { NextResponse, type NextRequest } from "next/server";

/**
 * Single-password gate.
 *
 * Set DESK_PASSWORD in your environment and every page plus every /api route
 * asks for it once, then remembers the browser for 30 days.
 *
 * With it unset the gate is off — that is only safe on localhost. If
 * NODE_ENV is production and no password is configured, the app refuses to
 * serve rather than leaving your pipeline world-readable.
 */
const COOKIE = "desk_pass";
const MAX_AGE = 60 * 60 * 24 * 30;

function expectedToken(password: string): string {
  // Simple opaque token: the password itself is never stored in the cookie.
  return Buffer.from(`desk:${password}`).toString("base64url");
}

function unauthorized(message: string, status = 401) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Lead Desk</title>
     <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0a0908;color:#eae4d4;font:16px/1.6 system-ui,sans-serif">
     <div style="max-width:360px;padding:0 24px">
       <div style="letter-spacing:.3em;font-size:11px;color:#c2a259;margin-bottom:18px">KGOMOTSO · LEAD DESK</div>
       <p style="margin:0 0 16px">${message}</p>
       <p style="margin:0;color:#8d8678;font-size:13px">Set DESK_PASSWORD in your environment and reload.</p>
     </div></body>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export function middleware(request: NextRequest) {
  const password = process.env.DESK_PASSWORD;

  if (!password) {
    if (process.env.NODE_ENV === "production") {
      return unauthorized("This desk is not configured yet.", 503);
    }
    return NextResponse.next();
  }

  const token = expectedToken(password);
  const url = new URL(request.url);

  // The login form posts the password to /__gate and is redirected back.
  if (url.pathname === "/__gate") {
    const supplied = url.searchParams.get("password") ?? "";
    const back = url.searchParams.get("next") ?? "/";
    if (supplied !== password) {
      return NextResponse.redirect(new URL(`/__login?error=1&next=${encodeURIComponent(back)}`, url));
    }
    const response = NextResponse.redirect(new URL(back, url));
    response.cookies.set(COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: url.protocol === "https:",
      path: "/",
      maxAge: MAX_AGE,
    });
    return response;
  }

  if (url.pathname === "/__login") {
    const error = url.searchParams.get("error") ? "That password is not right." : "";
    const next = url.searchParams.get("next") ?? "/";
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
       <title>Lead Desk</title>
       <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
         background:#0a0908;color:#eae4d4;font:16px/1.6 system-ui,sans-serif">
       <form method="get" action="/__gate" style="width:100%;max-width:340px;padding:0 24px">
         <div style="letter-spacing:.3em;font-size:11px;color:#c2a259;margin-bottom:22px">KGOMOTSO · LEAD DESK</div>
         <input type="hidden" name="next" value="${next.replace(/"/g, "&quot;")}">
         <input name="password" type="password" autofocus placeholder="Password"
           style="width:100%;box-sizing:border-box;padding:14px 16px;border-radius:10px;border:1px solid #2a2721;
             background:#121110;color:#eae4d4;font-size:15px;outline:none">
         <button type="submit" style="width:100%;margin-top:12px;padding:14px 16px;border-radius:10px;border:0;
           background:#c2a259;color:#0a0908;font-size:14px;font-weight:700;letter-spacing:.02em;cursor:pointer">Open the desk</button>
         ${error ? `<p style="color:#cf6f58;font-size:13px;margin:14px 0 0">${error}</p>` : ""}
       </form></body>`,
      { status: error ? 401 : 200, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  // Already signed in.
  if (request.cookies.get(COOKIE)?.value === token) return NextResponse.next();

  // The export and import routes answer to the same cookie. Anything else
  // that is not the desk gets the login page.
  if (url.pathname.startsWith("/api/")) {
    return NextResponse.json({ ok: false, error: "Unauthorised." }, { status: 401 });
  }
  return NextResponse.redirect(new URL(`/__login?next=${encodeURIComponent(url.pathname + url.search)}`, url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
