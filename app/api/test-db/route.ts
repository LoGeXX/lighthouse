import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"

export async function GET() {
  try {
    const client = createClient()
    await client.connect()

    // Simple query to test connection
    const result = await client.query("SELECT NOW()")
    await client.end()

    return NextResponse.json({
      success: true,
      message: "Database connection successful",
      timestamp: result.rows[0].now,
    })
  } catch (error) {
    console.error("Database connection error:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to connect to database",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

