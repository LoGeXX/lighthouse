export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"
import { v4 as uuidv4 } from "uuid"
import { randomBytes } from "crypto"

// Function to generate a serial key
function generateSerialKey() {
  const segments = []
  for (let i = 0; i < 5; i++) {
    const segment = randomBytes(5).toString("hex").toUpperCase().substring(0, 5)
    segments.push(segment)
  }
  return segments.join("-")
}

export async function POST(request: Request) {
  try {
    // Log the request headers for debugging
    const headers = Object.fromEntries(request.headers)
    console.log("Webhook Headers:", JSON.stringify(headers, null, 2))

    // Try to parse as form data first
    let purchaseId, email, licenseKey, productId

    try {
      const formData = await request.formData()

      // Log all form data fields for debugging
      const formDataObj: Record<string, any> = {}
      formData.forEach((value, key) => {
        formDataObj[key] = value
      })
      console.log("Form Data:", JSON.stringify(formDataObj, null, 2))

      purchaseId = (formData.get("sale_id") as string) || (formData.get("purchase_id") as string)
      email = formData.get("email") as string
      licenseKey = formData.get("license_key") as string
      productId = formData.get("product_id") as string
    } catch (formError) {
      console.log("Failed to parse as form data, trying JSON:", formError)

      // If form data parsing fails, try JSON
      try {
        const jsonData = await request.json()
        console.log("JSON Data:", JSON.stringify(jsonData, null, 2))

        purchaseId = jsonData.sale_id || jsonData.purchase_id
        email = jsonData.email
        licenseKey = jsonData.license_key
        productId = jsonData.product_id
      } catch (jsonError) {
        console.log("Failed to parse as JSON:", jsonError)

        // If both fail, try text
        try {
          const textData = await request.text()
          console.log("Text Data:", textData)

          // Try to parse as URL-encoded form data
          const params = new URLSearchParams(textData)
          purchaseId = params.get("sale_id") || params.get("purchase_id")
          email = params.get("email")
          licenseKey = params.get("license_key")
          productId = params.get("product_id")
        } catch (textError) {
          console.log("Failed to parse as text:", textError)
        }
      }
    }

    // Log the extracted values
    console.log("Extracted values:", { purchaseId, email, licenseKey, productId })

    // Handle missing required fields more gracefully
    if (!purchaseId) {
      console.log("Missing purchase ID")
      return NextResponse.json(
        {
          error: "Missing purchase ID",
          success: false,
        },
        { status: 400 },
      )
    }

    if (!email) {
      console.log("Missing email")
      return NextResponse.json(
        {
          error: "Missing email",
          success: false,
        },
        { status: 400 },
      )
    }

    // License key might not always be provided by Gumroad
    if (!licenseKey) {
      console.log("Missing license key, generating a placeholder")
      licenseKey = `gumroad-${Date.now()}`
    }

    const client = createClient()
    await client.connect()

    // Check if this purchase already has a key
    const existingKey = await client.query('SELECT key FROM "SerialKeys" WHERE gumroad_purchase_id = $1', [purchaseId])

    let serialKey

    if (existingKey.rows.length > 0) {
      serialKey = existingKey.rows[0].key
      console.log("Found existing key:", serialKey)
    } else {
      // Generate a new serial key
      serialKey = generateSerialKey()
      console.log("Generated new key:", serialKey)

      // Store the key in the database
      await client.query(
        `INSERT INTO "SerialKeys" (id, key, email, purchased_at, is_active, gumroad_license_key, gumroad_purchase_id, created_at)
         VALUES ($1, $2, $3, NOW(), true, $4, $5, NOW())`,
        [uuidv4(), serialKey, email, licenseKey, purchaseId],
      )
    }

    await client.end()

    // Return success response
    return NextResponse.json({
      success: true,
      key: serialKey,
      message: "License key generated successfully",
    })
  } catch (error) {
    console.error("Error processing Gumroad webhook:", error)
    return NextResponse.json(
      {
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : String(error),
        success: false,
      },
      { status: 500 },
    )
  }
}

