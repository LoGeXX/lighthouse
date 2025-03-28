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

    // Normalize the key by removing hyphens and converting to uppercase
    const normalizedKey = key.replace(/-/g, "").toUpperCase()

    const client = createClient()
    await client.connect()

    // Log the query we're about to execute
    console.log(`Checking for key: ${key} (normalized: ${normalizedKey})`)

    // First try with the exact key format
    let keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE key = $1', [key])

    // If no results, try with the normalized key
    if (keyResult.rows.length === 0) {
      // Try to find the key by matching the normalized version
      const allKeysResult = await client.query('SELECT id, key, is_active FROM "SerialKeys"')

      for (const row of allKeysResult.rows) {
        const normalizedDbKey = row.key.replace(/-/g, "").toUpperCase()
        if (normalizedDbKey === normalizedKey) {
          // Instead of creating a new object, modify the query to get this specific key
          keyResult = await client.query('SELECT id, is_active FROM "SerialKeys" WHERE key = $1', [row.key])
          console.log(`Found matching key: ${row.key}`)
          break
        }
      }
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
      console.log("Key is not active:", key)
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
      'SELECT id, device_id, machine_id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
      [serialKeyId],
    )

    if (otherActivationResult.rows.length > 0) {
      console.log("Key is already activated on another device")

      // Check if it's the same device with a different ID (this can happen if the device ID generation changes)
      const otherDeviceId = otherActivationResult.rows[0].device_id
      const otherMachineId = otherActivationResult.rows[0].machine_id

      // If the machine ID is the same but device ID is different, we can consider it the same device
      if (otherMachineId === machineId) {
        console.log("Same machine detected with different device ID, updating activation")

        // Update the activation with the new device ID
        await client.query('UPDATE "Activations" SET device_id = $1 WHERE id = $2', [
          deviceId,
          otherActivationResult.rows[0].id,
        ])

        await client.end()
        return NextResponse.json(
          { valid: true, activated: true },
          {
            headers: corsHeaders,
          },
        )
      }

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

