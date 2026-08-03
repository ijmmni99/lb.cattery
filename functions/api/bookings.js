const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  const { SUPABASE_URL, SUPABASE_ANON_KEY } = env;
  const base = `${SUPABASE_URL}/rest/v1/bookings`;
  const auth = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (request.method === "GET") {
    const res = await fetch(`${base}?select=*`, { headers: auth });
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: CORS });
  }

  if (request.method === "POST") {
    const body = await request.json();
    const res = await fetch(base, {
      method: "POST",
      headers: { ...auth, "Prefer": "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(body),
    });
    return new Response(null, { status: res.ok ? 200 : 500, headers: CORS });
  }

  if (request.method === "DELETE" && id) {
    const res = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: auth,
    });
    return new Response(null, { status: res.ok ? 200 : 500, headers: CORS });
  }

  return new Response("Not found", { status: 404, headers: CORS });
}
