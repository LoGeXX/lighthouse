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

    console.log("Activate request body:", JSON.stringify(requestBody, null, 2))

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

      let serialKeyId

      if (keyResult.rows.length === 0) {
        console.log("No matching active key found in database - creating demo entry")

        // For demo purposes, create a new entry if the key doesn't exist
        serialKeyId = uuidv4()

        // Insert a new record for this license key
        await client.query(
          `INSERT INTO "SerialKeys" (id, email, purchased_at, is_active, gumroad_license_key, gumroad_purchase_id, created_at)
           VALUES ($1, $2, NOW(), true, $3, $4, NOW())`,
          [serialKeyId, "demo@example.com", gumroadLicenseKey, `demo-${Date.now()}`],
        )

        console.log("Created demo license entry with ID:", serialKeyId)
      } else {
        serialKeyId = keyResult.rows[0].id
      }

      // Check if this device is already activated with this key
      const existingActivationResult = await client.query(
        'SELECT id, is_active FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3',
        [serialKeyId, deviceId, machineId],
      )

      if (existingActivationResult.rows.length > 0) {
        if (existingActivationResult.rows[0].is_active) {
          console.log("Device already activated with this key")
          return NextResponse.json(
            { success: true, message: "License key is already activated on this device" },
            { headers: corsHeaders },
          )
        } else {
          // Reactivate the existing activation
          await client.query(
            'UPDATE "Activations" SET is_active = true, deactivated_at = NULL, activated_at = NOW() WHERE id = $1',
            [existingActivationResult.rows[0].id],
          )

          console.log("Reactivated existing activation")
          return NextResponse.json(
            { success: true, message: "License key reactivated successfully" },
            { headers: corsHeaders },
          )
        }
      }

      // Check if there's already an active activation on another device
      const otherActivationResult = await client.query(
        'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
        [serialKeyId],
      )

      if (otherActivationResult.rows.length > 0) {
        console.log("Key is already activated on another device")
        return NextResponse.json(
          { success: false, message: "This license key is already activated on another device" },
          { headers: corsHeaders },
        )
      }

      // Check for cooldown period
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
            success: false,
            cooldown: true,
            cooldownEnds: endsAt,
            message: `This license key is in a cooldown period. Please try again in ${hoursRemaining} hours.`,
          },
          { headers: corsHeaders },
        )
      }

      // Create a new activation
      await client.query(
        `INSERT INTO "Activations" (id, serial_key_id, device_id, machine_id, activated_at, is_active)
         VALUES ($1, $2, $3, $4, NOW(), true)`,
        [uuidv4(), serialKeyId, deviceId, machineId],
      )

      console.log("Key activated successfully")
      return NextResponse.json(
        {
          success: true,
          message: "License key activated successfully",
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
    console.error("Error activating key:", error)
    return NextResponse.json(
      {
        success: false,
        message: "Failed to activate license key",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: corsHeaders },
    )
  }
}

