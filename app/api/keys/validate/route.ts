export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400", // 24 hours
    },
  })
}

export async function POST(request: Request) {
  // Add CORS headers to the response
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }

  try {
    const { key, deviceId, machineId } = await request.json()

    if (!key || !deviceId || !machineId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    const client = createClient()
    await client.connect()

    // Check if the key exists and is active
    const keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE key = $1', [key])

    if (keyResult.rows.length === 0) {
      await client.end()
      return NextResponse.json(
        { valid: false, message: "Invalid serial key" },
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    const serialKeyId = keyResult.rows[0].id
    const isKeyActive = keyResult.rows[0].is_active

    if (!isKeyActive) {
      await client.end()
      return NextResponse.json(
        { valid: false, message: "This serial key has been deactivated" },
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    // Check if this device is already activated with this key
    const activationResult = await client.query(
      'SELECT id, is_active FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3',
      [serialKeyId, deviceId, machineId],
    )

    if (activationResult.rows.length > 0 && activationResult.rows[0].is_active) {
      await client.end()
      return NextResponse.json(
        { valid: true, activated: true },
        {
          headers: corsHeaders,
        },
      )
    }

    // Check if there's an active activation for this key (with a different device)
    const otherActivationResult = await client.query(
      'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
      [serialKeyId],
    )

    if (otherActivationResult.rows.length > 0) {
      await client.end()
      return NextResponse.json(
        {
          valid: true,
          activated: false,
          message: "This key is already activated on another device. Please deactivate it first.",
        },
        {
          headers: corsHeaders,
        },
      )
    }

    // Check if there's an active cooldown period
    const cooldownResult = await client.query(
      'SELECT ends_at FROM "CooldownPeriods" WHERE serial_key_id = $1 AND is_active = true AND ends_at > NOW()',
      [serialKeyId],
    )

    if (cooldownResult.rows.length > 0) {
      const endsAt = new Date(cooldownResult.rows[0].ends_at)
      const now = new Date()
      const hoursRemaining = Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60))

      await client.end()
      return NextResponse.json(
        {
          valid: true,
          activated: false,
          cooldown: true,
          cooldownEnds: endsAt,
          message: `This key is in a cooldown period. Please try again in ${hoursRemaining} hours.`,
        },
        {
          headers: corsHeaders,
        },
      )
    }

    await client.end()
    return NextResponse.json(
      { valid: true, activated: false },
      {
        headers: corsHeaders,
      },
    )
  } catch (error) {
    console.error("Error validating key:", error)
    return NextResponse.json(
      { error: "Failed to validate key" },
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
}

