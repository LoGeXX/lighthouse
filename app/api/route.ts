export const runtime = "nodejs"

import { NextResponse } from "next/server"

// Add CORS headers to the response
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400", // 24 hours
    },
  })
}

// Add CORS headers to the GET response
export async function GET() {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }

  return NextResponse.json(
    {
      status: "ok",
      message: "Lighthouse Pro License API is running",
      version: "1.0.0",
      endpoints: [
        "/api/keys/generate",
        "/api/keys/validate",
        "/api/keys/activate",
        "/api/keys/deactivate",
        "/api/gumroad/webhook",
        "/api/setup-db",
        "/api/test",
        "/api/test-db",
      ],
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders },
  )
}

