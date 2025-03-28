export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@vercel/postgres"

// Add CORS headers to all responses
function addCorsHeaders(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*")
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  return response
}

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
    // Parse the request body
    let requestBody
    try {
      requestBody = await request.json()
    } catch (error) {
      console.error("Error parsing request body:", error)
      return NextResponse.json(
        { success: false, message: "Invalid request body" },
        { status: 400, headers: corsHeaders },
      )
    }

    console.log("Deactivate request body:", JSON.stringify(requestBody, null, 2))

    const { gumroadLicenseKey, deviceId, machineId } = requestBody

    if (!gumroadLicenseKey) {
      console.log("Missing license key")
      return NextResponse.json(
        { success: false, message: "License key is required" },
        { status: 400, headers: corsHeaders },
      )
    }

    if (!deviceId || !machineId) {
      console.log("Missing device or machine ID")
      return NextResponse.json(
        { success: false, message: "Device ID and Machine ID are required" },
        { status: 400, headers: corsHeaders },
      )
    }

    const client = createClient()
    await client.connect()

    try {
      // Check for the license key in the gumroad_license_key field
      console.log(`Checking for gumroadLicenseKey: ${gumroadLicenseKey}`)
      const keyResult = await client.query(
        'SELECT id FROM "SerialKeys" WHERE gumroad_license_key = $1 AND is_active = true',
        [gumroadLicenseKey],
      )

      if (keyResult.rows.length === 0) {
        console.log("No matching active key found in database")
        return NextResponse.json(
          { success: false, message: "Invalid or inactive license key" },
          { headers: corsHeaders },
        )
      }

      const serialKeyId = keyResult.rows[0].id

      // Check if this device is activated with this key
      const activationResult = await client.query(
        'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3 AND is_active = true',
        [serialKeyId, deviceId, machineId],
      )

      if (activationResult.rows.length === 0) {
        console.log("Device is not activated with this key")
        return NextResponse.json(
          { success: false, message: "This device is not activated with this license key" },
          { headers: corsHeaders },
        )
      }

      const activationId = activationResult.rows[0].id

      // Deactivate the activation
      await client.query('UPDATE "Activations" SET is_active = false, deactivated_at = NOW() WHERE id = $1', [
        activationId,
      ])

      // Create a cooldown period (2 hours)
      const cooldownEnds = new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours from now

      await client.query(
        `INSERT INTO "CooldownPeriods" (id, serial_key_id, started_at, ends_at, is_active)
         VALUES ($1, $2, NOW(), $3, true)`,
        [uuidv4(), serialKeyId, cooldownEnds],
      )

      console.log("Key deactivated successfully")
      return NextResponse.json(
        {
          success: true,
          message: "License key deactivated successfully",
          cooldownEnds: cooldownEnds,
        },
        { headers: corsHeaders },
      )
    } finally {
      // Ensure client is closed even if there's an error
      if (client) {
        await client.end().catch(console.error)
      }
    }
  } catch (error) {
    console.error("Error deactivating key:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to deactivate license key",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: corsHeaders },
    )
  }
}

