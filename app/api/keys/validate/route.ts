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
    // Parse the request body
    let requestBody
    try {
      requestBody = await request.json()
    } catch (error) {
      console.error("Error parsing request body:", error)
      return NextResponse.json(
        { success: false, valid: false, message: "Invalid request body" },
        { status: 400, headers: corsHeaders },
      )
    }

    console.log("Validate request body:", JSON.stringify(requestBody, null, 2))

    const { gumroadLicenseKey, deviceId, machineId } = requestBody

    if (!gumroadLicenseKey) {
      console.log("Missing license key")
      return NextResponse.json(
        { success: false, valid: false, message: "License key is required" },
        { status: 400, headers: corsHeaders },
      )
    }

    if (!deviceId || !machineId) {
      console.log("Missing device or machine ID")
      return NextResponse.json(
        { success: false, valid: false, message: "Device ID and Machine ID are required" },
        { status: 400, headers: corsHeaders },
      )
    }

    const client = createClient()
    await client.connect()

    try {
      // Check for the license key in the gumroad_license_key field
      console.log(`Checking for gumroadLicenseKey: ${gumroadLicenseKey}`)
      const keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE gumroad_license_key = $1', [
        gumroadLicenseKey,
      ])

      if (keyResult.rows.length === 0) {
        console.log("No matching key found in database")
        return NextResponse.json(
          { success: false, valid: false, message: "Invalid license key" },
          { headers: corsHeaders },
        )
      }

      const serialKeyId = keyResult.rows[0].id
      const isKeyActive = keyResult.rows[0].is_active

      if (!isKeyActive) {
        console.log("Key is not active:", gumroadLicenseKey)
        return NextResponse.json(
          { success: false, valid: false, message: "This license key has been deactivated" },
          { headers: corsHeaders },
        )
      }

      // Check if this device is already activated with this key
      const activationResult = await client.query(
        'SELECT id, is_active FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3',
        [serialKeyId, deviceId, machineId],
      )

      if (activationResult.rows.length > 0 && activationResult.rows[0].is_active) {
        console.log("Device already activated with this key")
        return NextResponse.json(
          { success: true, valid: true, activated: true, message: "License is valid and activated on this device" },
          { headers: corsHeaders },
        )
      }

      // Check if there's an active activation for this key (with a different device)
      const otherActivationResult = await client.query(
        'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
        [serialKeyId],
      )

      if (otherActivationResult.rows.length > 0) {
        console.log("Key is already activated on another device")
        return NextResponse.json(
          {
            success: true,
            valid: true,
            activated: false,
            message: "This license key is already activated on another device. Please deactivate it first.",
          },
          { headers: corsHeaders },
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
        return NextResponse.json(
          {
            success: true,
            valid: true,
            activated: false,
            cooldown: true,
            cooldownEnds: endsAt,
            message: `This license key is in a cooldown period. Please try again in ${hoursRemaining} hours.`,
          },
          { headers: corsHeaders },
        )
      }

      console.log("Key is valid but not activated")
      return NextResponse.json(
        {
          success: true,
          valid: true,
          activated: false,
          message: "License key is valid and ready to be activated",
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
    console.error("Error validating key:", error)
    return NextResponse.json(
      {
        success: false,
        valid: false,
        message: "Failed to validate license key",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: corsHeaders },
    )
  }
}

