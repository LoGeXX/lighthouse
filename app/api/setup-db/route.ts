export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"

// Add CORS headers to all responses
function addCorsHeaders(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*")
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization")
  return response
}

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

export async function GET() {
  // Add CORS headers to the response
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }

  try {
    const client = createClient()
    await client.connect()

    // Create UUID extension if it doesn't exist
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`)

    // Create SerialKeys table - key field is now nullable
    await client.query(`
      CREATE TABLE IF NOT EXISTS "SerialKeys" (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        key VARCHAR(255) UNIQUE NULL,
        email VARCHAR(255) NOT NULL,
        purchased_at TIMESTAMP NOT NULL DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true,
        gumroad_license_key VARCHAR(255) UNIQUE NOT NULL,
        gumroad_purchase_id VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `)

    // Create Activations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "Activations" (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        serial_key_id UUID REFERENCES "SerialKeys"(id),
        device_id VARCHAR(255) NOT NULL,
        machine_id VARCHAR(255) NOT NULL,
        activated_at TIMESTAMP NOT NULL DEFAULT NOW(),
        deactivated_at TIMESTAMP,
        is_active BOOLEAN DEFAULT true,
        UNIQUE(serial_key_id, device_id, machine_id)
      )
    `)

    // Create CooldownPeriods table
    await client.query(`
      CREATE TABLE IF NOT EXISTS "CooldownPeriods" (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        serial_key_id UUID REFERENCES "SerialKeys"(id),
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        ends_at TIMESTAMP NOT NULL,
        is_active BOOLEAN DEFAULT true
      )
    `)

    await client.end()

    return NextResponse.json({ success: true, message: "Database setup complete" }, { headers: corsHeaders })
  } catch (error) {
    console.error("Error setting up database:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to set up database",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: corsHeaders },
    )
  }
}

