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
    // Log the request body for debugging
    const requestBody = await request.json()
    console.log("Validate request body:", JSON.stringify(requestBody, null, 2))

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
    let licenseResult = await client.query('SELECT id, is_active FROM "Licenses" WHERE gumroad_license_key = $1', [
      normalizedKey,
    ])

    // If no results, try with different formats (with or without hyphens)
    if (licenseResult.rows.length === 0) {
      // Try with hyphens if the key doesn't have them
      if (!normalizedKey.includes("-")) {
        // Format like XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX (assuming 8 chars per segment)
        const keyWithHyphens = normalizedKey.match(/.{1,8}/g)?.join("-")
        if (keyWithHyphens) {
          licenseResult = await client.query('SELECT id, is_active FROM "Licenses" WHERE gumroad_license_key = $1', [
            keyWithHyphens,
          ])
        }
      } else {
        // Try without hyphens if the key has them
        const keyWithoutHyphens = normalizedKey.replace(/-/g, "")
        licenseResult = await client.query('SELECT id, is_active FROM "Licenses" WHERE gumroad_license_key = $1', [
          keyWithoutHyphens,
        ])
      }
    }

    if (licenseResult.rows.length === 0) {
      console.log("No matching license key found in database")
      await client.end()
      return NextResponse.json(
        { valid: false, message: "Invalid license key" },
        {
          status: 200, // Changed from 400 to 200 to avoid CORS issues
          headers: corsHeaders,
        },
      )
    }

    const licenseId = licenseResult.rows[0].id
    const isLicenseActive = licenseResult.rows[0].is_active

    if (!isLicenseActive) {
      console.log("License is not active:", key)
      await client.end()
      return NextResponse.json(
        { valid: false, message: "This license key has been deactivated" },
        {
          status: 200, // Changed from 400 to 200
          headers: corsHeaders,
        },
      )
    }

    // Check if this device is already activated with this license
    const activationResult = await client.query(
      'SELECT id, is_active FROM "Activations" WHERE license_id = $1 AND device_id = $2 AND machine_id = $3',
      [licenseId, deviceId, machineId],
    )

    if (activationResult.rows.length > 0 && activationResult.rows[0].is_active) {
      console.log("Device already activated with this license")
      await client.end()
      return NextResponse.json(
        { valid: true, activated: true },
        {
          headers: corsHeaders,
        },
      )
    }

    // Check if there's an active activation for this license (with a different device)
    const otherActivationResult = await client.query(
      'SELECT id FROM "Activations" WHERE license_id = $1 AND is_active = true',
      [licenseId],
    )

    if (otherActivationResult.rows.length > 0) {
      console.log("License is already activated on another device")
      await client.end()
      return NextResponse.json(
        {
          valid: true,
          activated: false,
          message: "This license is already activated on another device. Please deactivate it first.",
        },
        {
          headers: corsHeaders,
        },
      )
    }

    // Check if there's an active cooldown period
    const cooldownResult = await client.query(
      'SELECT ends_at FROM "CooldownPeriods" WHERE license_id = $1 AND is_active = true AND ends_at > NOW()',
      [licenseId],
    )

    if (cooldownResult.rows.length > 0) {
      const endsAt = new Date(cooldownResult.rows[0].ends_at)
      const now = new Date()
      const hoursRemaining = Math.ceil((endsAt.getTime() - now.getTime()) / (1000 * 60 * 60))

      console.log("License is in cooldown period")
      await client.end()
      return NextResponse.json(
        {
          valid: true,
          activated: false,
          cooldown: true,
          cooldownEnds: endsAt,
          message: `This license is in a cooldown period. Please try again in ${hoursRemaining} hours.`,
        },
        {
          headers: corsHeaders,
        },
      )
    }

    console.log("License is valid but not activated")
    await client.end()
    return NextResponse.json(
      { valid: true, activated: false },
      {
        headers: corsHeaders,
      },
    )
  } catch (error) {
    console.error("Error validating license:", error)
    return NextResponse.json(
      { error: "Failed to validate license" },
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }
}

