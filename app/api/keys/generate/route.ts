import { NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@vercel/postgres"
import { randomBytes } from "crypto"

// Function to generate a serial key
function generateSerialKey() {
  // Generate 5 groups of 5 alphanumeric characters separated by hyphens
  const segments = []
  for (let i = 0; i < 5; i++) {
    const segment = randomBytes(5).toString("hex").toUpperCase().substring(0, 5)
    segments.push(segment)
  }
  return segments.join("-")
}

export async function POST(request: Request) {
  try {
    const { email, gumroadLicenseKey, gumroadPurchaseId } = await request.json()

    if (!email || !gumroadLicenseKey || !gumroadPurchaseId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const client = createClient()
    await client.connect()

    // Check if this Gumroad purchase already has a key
    const existingKey = await client.query('SELECT key FROM "SerialKeys" WHERE gumroad_purchase_id = $1', [
      gumroadPurchaseId,
    ])

    if (existingKey.rows.length > 0) {
      await client.end()
      return NextResponse.json({ key: existingKey.rows[0].key })
    }

    // Generate a new serial key
    const serialKey = generateSerialKey()

    // Store the key in the database
    await client.query(
      `INSERT INTO "SerialKeys" (id, key, email, purchased_at, is_active, gumroad_license_key, gumroad_purchase_id, created_at)
       VALUES ($1, $2, $3, NOW(), true, $4, $5, NOW())`,
      [uuidv4(), serialKey, email, gumroadLicenseKey, gumroadPurchaseId],
    )

    await client.end()

    return NextResponse.json({ key: serialKey })
  } catch (error) {
    console.error("Error generating key:", error)
    return NextResponse.json({ error: "Failed to generate key" }, { status: 500 })
  }
}

