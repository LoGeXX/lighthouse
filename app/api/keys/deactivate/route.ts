import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@vercel/postgres"

export async function POST(request: Request) {
  try {
    const { key, deviceId, machineId } = await request.json()

    if (!key || !deviceId || !machineId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const client = createClient()
    await client.connect()

    // Get the serial key ID
    const keyResult = await client.query('SELECT id FROM "SerialKeys" WHERE key = $1 AND is_active = true', [key])

    if (keyResult.rows.length === 0) {
      await client.end()
      return NextResponse.json({ success: false, message: "Invalid or inactive serial key" }, { status: 400 })
    }

    const serialKeyId = keyResult.rows[0].id

    // Check if this device is activated with this key
    const activationResult = await client.query(
      'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND device_id = $2 AND machine_id = $3 AND is_active = true',
      [serialKeyId, deviceId, machineId],
    )

    if (activationResult.rows.length === 0) {
      await client.end()
      return NextResponse.json(
        { success: false, message: "This device is not activated with this key" },
        { status: 400 },
      )
    }

    const activationId = activationResult.rows[0].id

    // Deactivate the activation
    await client.query('UPDATE "Activations" SET is_active = false, deactivated_at = NOW() WHERE id = $1', [
      activationId,
    ])

    // Create a cooldown period (3 days)
    await client.query(
      `INSERT INTO "CooldownPeriods" (id, serial_key_id, started_at, ends_at, is_active)
       VALUES ($1, $2, NOW(), NOW() + INTERVAL '3 days', true)`,
      [uuidv4(), serialKeyId],
    )

    await client.end()

    return NextResponse.json({
      success: true,
      message: "Serial key deactivated successfully",
      cooldownEnds: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    })
  } catch (error) {
    console.error("Error deactivating key:", error)
    return NextResponse.json({ error: "Failed to deactivate key" }, { status: 500 })
  }
}

