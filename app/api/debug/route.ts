import { NextResponse } from "next/server"

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Debug API is working",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
    // Don't include sensitive environment variables here
    hasPostgresUrl: !!process.env.POSTGRES_URL,
  })
}

