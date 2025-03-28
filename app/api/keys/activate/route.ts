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
    let keyResult = await client.query('SELECT id FROM "SerialKeys" WHERE key = $1 AND is_active = true', [key])

    // If no results, try with the normalized key
    if (keyResult.rows.length === 0) {
      // Try to find the key by matching the normalized version
      const allKeysResult = await client.query('SELECT id, key, is_active FROM "SerialKeys" WHERE is_active = true')

      let matchingKey = null
      for (const row of allKeysResult.rows) {
        const normalizedDbKey = row.key.replace(/-/g, "").toUpperCase()
        if (normalizedDbKey === normalizedKey) {
          matchingKey = row.key
          console.log(`Found matching key: ${row.key}`)
          break
        }
      }

      if (matchingKey) {
        // Query again with the exact matching key
        keyResult = await client.query('SELECT id FROM "SerialKeys" WHERE key = $1 AND is_active = true', [matchingKey])
      }
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

    // Check if this device/machine has been activated before with this key
    const existingActivationResult = await client.query(
      'SELECT id, is_active FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3',
      [serialKeyId, deviceId, machineId],
    )

    // If this device was previously activated with this key, just reactivate it
    if (existingActivationResult.rows.length > 0) {
      // If it's already active, just return success
      if (existingActivationResult.rows[0].is_active) {
        console.log("Device already activated with this key")
        await client.end()
        return NextResponse.json(
          {
            success: true,
            message: "Device already activated with this key",
          },
          {
            headers: corsHeaders,
          },
        )
      }

      // Otherwise, reactivate it
      await client.query(
        `UPDATE "Activations" 
         SET is_active = true, 
             activated_at = NOW(), 
             deactivated_at = NULL 
         WHERE id = $1`,
        [existingActivationResult.rows[0].id],
      )

      console.log("Reactivated existing device")

      // Clean up any cooldown periods for this key
      await client.query(
        `UPDATE "CooldownPeriods" 
         SET is_active = false 
         WHERE serial_key_id = $1`,
        [serialKeyId],
      )

      await client.end()
      return NextResponse.json(
        {
          success: true,
          message: "Serial key reactivated successfully",
        },
        {
          headers: corsHeaders,
        },
      )
    }

    // Check if there's already an active activation for this key (with a different device)
    const otherActivationResult = await client.query(
      'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
      [serialKeyId],
    )

    if (otherActivationResult.rows.length > 0) {
      console.log("Key is already activated on another device")
      await client.end()
      return NextResponse.json(
        { success: false, message: "This key is already activated on another device. Please deactivate it first." },
        {
          status: 200,
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

    // Clean up old cooldown periods
    await cleanupCooldownPeriods(client)

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

// Function to clean up old cooldown periods
async function cleanupCooldownPeriods(client: any) {
  try {
    // Delete expired cooldown periods
    const result = await client.query(
      `DELETE FROM "CooldownPeriods" 
       WHERE ends_at < NOW() OR is_active = false`,
    )

    console.log(`Cleaned up ${result.rowCount} expired cooldown periods`)

    return result.rowCount
  } catch (error) {
    console.error("Error cleaning up cooldown periods:", error)
    return 0
  }
}

