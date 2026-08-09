import { NextRequest } from "next/server";

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  boundingbox: [string, string, string, string];
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  if (!q) return Response.json({ error: "q required" }, { status: 400 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "NOVA-Assistant/1.0 (personal project)" },
    });
    if (!res.ok) {
      return Response.json({ error: "geocode_error", status: res.status }, { status: 502 });
    }
    const data = (await res.json()) as NominatimResult[];
    if (!data.length) return Response.json({ error: "not_found" }, { status: 404 });

    const r = data[0];
    return Response.json({
      lat: parseFloat(r.lat),
      lon: parseFloat(r.lon),
      displayName: r.display_name,
      boundingBox: r.boundingbox.map(Number) as [number, number, number, number],
    });
  } catch (err) {
    console.error("[geocode] error:", err);
    return Response.json({ error: "geocode_failed" }, { status: 500 });
  }
}
