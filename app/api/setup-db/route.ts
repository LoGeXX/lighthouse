export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"

export async function GET() {
  try {
    const client = createClient()
    await client.connect()

    // Create Licenses table (using Gumroad keys)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Licenses" (
        id UUID PRIMARY KEY,
        gumroad_license_key VARCHAR(255) UNIQUE NOT NULL,
        gumroad_purchase_id VARCHAR(255) UNIQUE,
        email VARCHAR(255) NOT NULL,
        purchased_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP NOT NULL
      )
    `)

    // Create Activations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Activations" (
        id UUID PRIMARY KEY,
        license_id UUID REFERENCES "Licenses"(id),
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
        license_id UUID REFERENCES "Licenses"(id),
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

