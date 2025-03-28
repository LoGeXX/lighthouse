export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
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
    // Log the request body for debugging
    const requestBody = await request.json()
    console.log("Deactivate request body:", JSON.stringify(requestBody, null, 2))

    const { key, gumroadLicenseKey, deviceId, machineId } = requestBody

    // Determine which key to use - prioritize gumroadLicenseKey
    const licenseKey = gumroadLicenseKey || key

    if (!licenseKey || !deviceId || !machineId) {
      console.log("Missing required fields:", { licenseKey, deviceId, machineId })
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

    try {
      // First try with gumroadLicenseKey field
      console.log(`Checking for gumroadLicenseKey: ${licenseKey}`)
      let keyResult = await client.query(
        'SELECT id FROM "SerialKeys" WHERE gumroad_license_key = $1 AND is_active = true',
        [licenseKey],
      )

      // If not found, try with the key field as fallback
      if (keyResult.rows.length === 0) {
        console.log(`No match for gumroadLicenseKey, checking key field: ${licenseKey}`)
        keyResult = await client.query('SELECT id FROM "SerialKeys" WHERE key = $1 AND is_active = true', [licenseKey])
      }

      if (keyResult.rows.length === 0) {
        console.log("No matching active key found in database")
        return NextResponse.json(
          { success: false, message: "Invalid or inactive serial key" },
          {
            status: 200, // Changed from 400 to 200
            headers: corsHeaders,
          },
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
          { success: false, message: "This device is not activated with this key" },
          {
            status: 200, // Changed from 400 to 200
            headers: corsHeaders,
          },
        )
      }

      const activationId = activationResult.rows[0].id

      // Deactivate the activation
      await client.query('UPDATE "Activations" SET is_active = false, deactivated_at = NOW() WHERE id = $1', [
        activationId,
      ])

      // Create a cooldown period (2 hours)
      await client.query(
        `INSERT INTO "CooldownPeriods" (id, serial_key_id, started_at, ends_at, is_active)
         VALUES ($1, $2, NOW(), NOW() + INTERVAL '2 hours', true)`,
        [uuidv4(), serialKeyId],
      )

      console.log("Key deactivated successfully")
      return NextResponse.json(
        {
          success: true,
          message: "Serial key deactivated successfully",
          cooldownEnds: new Date(Date.now() + 2 * 60 * 60 * 1000),
        },
        {
          headers: corsHeaders,
        },
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
      { error: "Failed to deactivate key" },
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
}

