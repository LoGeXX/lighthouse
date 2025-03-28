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

    // Check if this device is activated with this key
    const activationResult = await client.query(
      'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3 AND is_active = true',
      [serialKeyId, deviceId, machineId],
    )

    if (activationResult.rows.length === 0) {
      console.log("Device is not activated with this key")
      await client.end()
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

    // Clean up old cooldown periods
    await cleanupCooldownPeriods(client)

    console.log("Key deactivated successfully")
    await client.end()

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

