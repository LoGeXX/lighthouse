export const runtime = "nodejs"

import { NextResponse } from "next/server"
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
    // Log the request body for debugging
    const requestBody = await request.json()
    console.log("Validate request body:", JSON.stringify(requestBody, null, 2))

    const { key, gumroadLicenseKey, deviceId, machineId, gumroadValidated } = requestBody

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
      let keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE gumroad_license_key = $1', [
        licenseKey,
      ])

      // If not found, try with the key field as fallback
      if (keyResult.rows.length === 0) {
        console.log(`No match for gumroadLicenseKey, checking key field: ${licenseKey}`)
        keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE key = $1', [licenseKey])
      }

      // If still not found and it was validated by Gumroad, create a new entry
      if (keyResult.rows.length === 0 && gumroadValidated) {
        console.log(`No existing key found, creating new entry for Gumroad key: ${licenseKey}`)
        await client.query(
          `INSERT INTO "SerialKeys" (id, key, email, gumroad_license_key, purchased_at, is_active, created_at)
           VALUES (uuid_generate_v4(), $1, $2, $1, NOW(), true, NOW())`,
          [licenseKey, "gumroad-user@example.com"],
        )

        // Get the newly created key
        keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE gumroad_license_key = $1', [
          licenseKey,
        ])
      }

      if (keyResult.rows.length === 0) {
        console.log("No matching key found in database")
        await client.end()
        return NextResponse.json(
          { valid: false, message: "Invalid serial key" },
          {
            status: 200, // Changed from 400 to 200 to avoid CORS issues
            headers: corsHeaders,
          },
        )
      }

      const serialKeyId = keyResult.rows[0].id
      const isKeyActive = keyResult.rows[0].is_active

      if (!isKeyActive) {
        console.log("Key is not active:", licenseKey)
        await client.end()
        return NextResponse.json(
          { valid: false, message: "This serial key has been deactivated" },
          {
            status: 200, // Changed from 400 to 200
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
        console.log("Device already activated with this key")
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
        console.log("Key is already activated on another device")
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

        console.log("Key is in cooldown period")
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

      console.log("Key is valid but not activated")
      await client.end()
      return NextResponse.json(
        { valid: true, activated: false },
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

