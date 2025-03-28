export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"

export async function GET(request: Request) {
  try {
    const client = createClient()
    await client.connect()

    // Clean up expired cooldown periods
    const cooldownResult = await client.query(
      `DELETE FROM "CooldownPeriods" 
       WHERE ends_at < NOW() OR is_active = false
       RETURNING id`,
    )

    // Clean up inactive activations older than 90 days
    const activationsResult = await client.query(
      `DELETE FROM "Activations" 
       WHERE is_active = false 
       AND deactivated_at < NOW() - INTERVAL '90 days'
       RETURNING id`,
    )

    await client.end()

    return NextResponse.json({
      success: true,
      message: "Database cleanup completed successfully",
      cooldownPeriodsRemoved: cooldownResult.rowCount,
      activationsRemoved: activationsResult.rowCount,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Error during database cleanup:", error)
    return NextResponse.json(
      {
        error: "Failed to perform database cleanup",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}

