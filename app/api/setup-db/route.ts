export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"

export async function GET() {
  try {
    const client = createClient()
    await client.connect()

    // Create SerialKeys table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "SerialKeys" (
        id UUID PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) NOT NULL,
        purchased_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true,
        gumroad_license_key VARCHAR(255),
        gumroad_purchase_id VARCHAR(255) UNIQUE,
        created_at TIMESTAMP NOT NULL
      )
    `)

    // Create Activations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Activations" (
        id UUID PRIMARY KEY,
        serial_key_id UUID REFERENCES "SerialKeys"(id),
        device_id VARCHAR(255) NOT NULL,
        machine_id VARCHAR(255) NOT NULL,
        activated_at TIMESTAMP NOT NULL,
        deactivated_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `)

    // Create CooldownPeriods table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "CooldownPeriods" (
        id UUID PRIMARY KEY,
        serial_key_id UUID REFERENCES "SerialKeys"(id),
        started_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `)

    await client.end()

    return NextResponse.json({ success: true, message: "Database setup complete" })
  } catch (error) {
    console.error("Error setting up database:", error)
    return NextResponse.json({ error: "Failed to set up database" }, { status: 500 })
  }
}

