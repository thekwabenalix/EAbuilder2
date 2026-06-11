/**
 * Phase 1 — /api/generate-code is retired (raw AI MQL5 violated verified-generator policy).
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const GENERATE_CODE_RETIRED_MESSAGE =
  "Raw MQL5 streaming generation is retired. Use the verified blueprint router (generateEaFromBlueprint) on the client.";

export default async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
  }

  return Response.json(
    {
      error: GENERATE_CODE_RETIRED_MESSAGE,
      code: "GENERATE_CODE_RETIRED",
    },
    { status: 410, headers: CORS },
  );
};

export const config = {
  path: "/api/generate-code",
};
