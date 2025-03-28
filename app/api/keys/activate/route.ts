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
    console.log("Activate request body:", JSON.stringify(requestBody, null, 2))

    const { key, deviceId, machineId, gumroadLicenseKey } = requestBody
    const licenseKeyToCheck = gumroadLicenseKey || key

    if (!licenseKeyToCheck || !deviceId || !machineId) {
      console.log("Missing required fields:", { licenseKeyToCheck, deviceId, machineId })
      return NextResponse.json(
        { error: "Missing required fields" },
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    // Normalize the key by removing hyphens and converting to uppercase
    const normalizedKey = licenseKeyToCheck.replace(/-/g, "").toUpperCase()

    const client = createClient()
    await client.connect()

    // Log the query we're about to execute
    console.log(`Checking for key: ${licenseKeyToCheck} (normalized: ${normalizedKey})`)

    // First try with gumroad_license_key
    let keyResult = await client.query(
      'SELECT id FROM "SerialKeys" WHERE gumroad_license_key = $1 AND is_active = true',
      [licenseKeyToCheck],
    )

    // If not found, try with the exact key format as fallback
    if (keyResult.rows.length === 0) {
      keyResult = await client.query('SELECT id FROM "SerialKeys" WHERE key = $1 AND is_active = true', [
        licenseKeyToCheck,
      ])
    }

    if (keyResult.rows.length === 0) {
      console.log("No matching active key found in database")
      await client.end()
      return NextResponse.json(
        { success: false, message: "Invalid or inactive serial key" },
        {
          status: 200, // Changed from 400 to 200
          headers: corsHeaders,
        },
      )
    }

    const serialKeyId = keyResult.rows[0].id

    // Check if there's already an active activation
    const activationResult = await client.query(
      'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
      [serialKeyId],
    )

    if (activationResult.rows.length > 0) {
      console.log("Key is already activated on another device")
      await client.end()
      return NextResponse.json(
        { success: false, message: "This key is already activated on another device" },
        {
          status: 200, // Changed from 400 to 200
          headers: corsHeaders,
        },
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
      await client.end()
      return NextResponse.json(
        {
          success: false,
          cooldown: true,
          cooldownEnds: endsAt,
          message: `This key is in a cooldown period. Please try again in ${hoursRemaining} hours.`,
        },
        {
          headers: corsHeaders,
        },
      )
    }

    // Create a new activation
    await client.query(
      `INSERT INTO "Activations" (id, serial_key_id, device_id, machine_id, activated_at, is_active)
       VALUES ($1, $2, $3, $4, NOW(), true)`,
      [uuidv4(), serialKeyId, deviceId, machineId],
    )

    console.log("Key activated successfully")
    await client.end()

    return NextResponse.json(
      {
        success: true,
        message: "Serial key activated successfully",
      },
      {
        headers: corsHeaders,
      },
    )
  } catch (error) {
    console.error("Error activating key:", error)
    return NextResponse.json(
      { error: "Failed to activate key" },
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
}

