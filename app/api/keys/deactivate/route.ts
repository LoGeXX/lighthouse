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

    const { key, deviceId, machineId } = requestBody

    if (!key || !deviceId || !machineId) {
      console.log("Missing required fields:", { key, deviceId, machineId })
      return NextResponse.json(
        { error: "Missing required fields" },
        {
          status: 400,
          headers: corsHeaders,
        },
      )
    }

    // Normalize the license key (remove any spaces, make uppercase)
    const normalizedKey = key.replace(/\s+/g, "").toUpperCase()

    const client = createClient()
    await client.connect()

    // Log the query we're about to execute
    console.log(`Checking for Gumroad license key: ${normalizedKey}`)

    // First try with the exact key format
    let licenseResult = await client.query(
      'SELECT id FROM "Licenses" WHERE gumroad_license_key = $1 AND is_active = true',
      [normalizedKey],
    )

    // If no results, try with different formats (with or without hyphens)
    if (licenseResult.rows.length === 0) {
      // Try with hyphens if the key doesn't have them
      if (!normalizedKey.includes("-")) {
        // Format like XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (assuming 8 chars per segment)
        const keyWithHyphens = normalizedKey.match(/.{1,8}/g)?.join("-")
        if (keyWithHyphens) {
          licenseResult = await client.query(
            'SELECT id FROM "Licenses" WHERE gumroad_license_key = $1 AND is_active = true',
            [keyWithHyphens],
          )
        }
      } else {
        // Try without hyphens if the key has them
        const keyWithoutHyphens = normalizedKey.replace(/-/g, "")
        licenseResult = await client.query(
          'SELECT id FROM "Licenses" WHERE gumroad_license_key = $1 AND is_active = true',
          [keyWithoutHyphens],
        )
      }
    }

    if (licenseResult.rows.length === 0) {
      console.log("No matching active license key found in database")
      await client.end()
      return NextResponse.json(
        { success: false, message: "Invalid or inactive license key" },
        {
          status: 200, // Changed from 400 to 200
          headers: corsHeaders,
        },
      )
    }

    const licenseId = licenseResult.rows[0].id

    // Check if this device is activated with this license
    const activationResult = await client.query(
      'SELECT id FROM "Activations" WHERE license_id = $1 AND device_id = $2 AND machine_id = $3 AND is_active = true',
      [licenseId, deviceId, machineId],
    )

    if (activationResult.rows.length === 0) {
      console.log("Device is not activated with this license")
      await client.end()
      return NextResponse.json(
        { success: false, message: "This device is not activated with this license" },
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
      `INSERT INTO "CooldownPeriods" (id, license_id, started_at, ends_at, is_active)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '2 hours', true)`,
      [uuidv4(), licenseId],
    )

    console.log("License deactivated successfully")
    await client.end()

    return NextResponse.json(
      {
        success: true,
        message: "License deactivated successfully",
        cooldownEnds: new Date(Date.now() + 2 * 60 * 60 * 1000),
      },
      {
        headers: corsHeaders,
      },
    )
  } catch (error) {
    console.error("Error deactivating license:", error)
    return NextResponse.json(
      { error: "Failed to deactivate license" },
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
}

