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

    // Check if there's already an active activation
    const activationResult = await client.query(
      'SELECT id FROM "Activations" WHERE serial_key_id = $1 AND is_active = true',
      [serialKeyId],
    )

    if (activationResult.rows.length > 0) {
      await client.end()
      return NextResponse.json(
        { success: false, message: "This key is already activated on another device" },
        { status: 400 },
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

      await client.end()
      return NextResponse.json({
        success: false,
        cooldown: true,
        cooldownEnds: endsAt,
        message: `This key is in a cooldown period. Please try again in ${hoursRemaining} hours.`,
      })
    }

    // Create a new activation
    await client.query(
      `INSERT INTO "Activations" (id, serial_key_id, device_id, machine_id, activated_at, is_active)
       VALUES ($1, $2, $3, $4, NOW(), true)`,
      [uuidv4(), serialKeyId, deviceId, machineId],
    )

    await client.end()

    return NextResponse.json({
      success: true,
      message: "Serial key activated successfully",
    })
  } catch (error) {
    console.error("Error activating key:", error)
    return NextResponse.json({ error: "Failed to activate key" }, { status: 500 })
  }
}

