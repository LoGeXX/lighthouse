import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"
import { v4 as uuidv4 } from "uuid"
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
    const formData = await request.formData()

    // Gumroad sends data as form data
    const purchaseId = formData.get("sale_id") as string
    const email = formData.get("email") as string
    const licenseKey = formData.get("license_key") as string
    const productId = formData.get("product_id") as string

    // Validate the webhook is from Gumroad for your product
    // You should add your product ID check here
    if (!purchaseId || !email || !licenseKey) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    const client = createClient()
    await client.connect()

    // Check if this purchase already has a key
    const existingKey = await client.query('SELECT key FROM "SerialKeys" WHERE gumroad_purchase_id = $1', [purchaseId])

    let serialKey

    if (existingKey.rows.length > 0) {
      serialKey = existingKey.rows[0].key
    } else {
      // Generate a new serial key
      serialKey = generateSerialKey()

      // Store the key in the database
      await client.query(
        `INSERT INTO "SerialKeys" (id, key, email, purchased_at, is_active, gumroad_license_key, gumroad_purchase_id, created_at)
         VALUES ($1, $2, $3, NOW(), true, $4, $5, NOW())`,
        [uuidv4(), serialKey, email, licenseKey, purchaseId],
      )
    }

    await client.end()

    // You could send an email to the customer with their serial key here

    return NextResponse.json({ success: true, key: serialKey })
  } catch (error) {
    console.error("Error processing Gumroad webhook:", error)
    return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 })
  }
}

