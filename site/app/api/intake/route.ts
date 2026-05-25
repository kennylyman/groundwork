export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "http://2.24.115.50:8901/intake";

export async function POST(request: Request) {
  const body = await request.text();

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "text/plain";

    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "upstream_unreachable", detail: String(err) }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}
