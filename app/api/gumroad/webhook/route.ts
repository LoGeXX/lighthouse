export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { createClient } from "@vercel/postgres"
import { v4 as uuidv4 } from "uuid"

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

export async function POST(request: Request) {
  // Add CORS headers to the response
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  }

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
        { status: 400, headers: corsHeaders },
      )
    }

    if (!email) {
      console.log("Missing email")
      return NextResponse.json(
        {
          error: "Missing email",
          success: false,
        },
        { status: 400, headers: corsHeaders },
      )
    }

    // License key is required from Gumroad
    if (!licenseKey) {
      console.log("Missing license key")
      return NextResponse.json(
        {
          error: "Missing license key",
          success: false,
        },
        { status: 400, headers: corsHeaders },
      )
    }

    const client = createClient()
    await client.connect()

    try {
      // Check if this purchase already has a key
      const existingKey = await client.query(
        'SELECT gumroad_license_key FROM "SerialKeys" WHERE gumroad_purchase_id = $1',
        [purchaseId],
      )

      if (existingKey.rows.length > 0) {
        const existingLicenseKey = existingKey.rows[0].gumroad_license_key
        console.log("Found existing license key:", existingLicenseKey)

        // Update the license key if it's changed
        if (existingLicenseKey !== licenseKey) {
          await client.query('UPDATE "SerialKeys" SET gumroad_license_key = $1 WHERE gumroad_purchase_id = $2', [
            licenseKey,
            purchaseId,
          ])
          console.log("Updated Gumroad license key:", licenseKey)
        }
      } else {
        // Store the key in the database - no serial key generation
        await client.query(
          `INSERT INTO "SerialKeys" (id, email, purchased_at, is_active, gumroad_license_key, gumroad_purchase_id, created_at)
           VALUES ($1, $2, NOW(), true, $3, $4, NOW())`,
          [uuidv4(), email, licenseKey, purchaseId],
        )
        console.log("Stored new Gumroad license key:", licenseKey)
      }

      await client.end()

      // Return success response
      return NextResponse.json(
        {
          success: true,
          gumroadLicenseKey: licenseKey,
          message: "License key processed successfully",
        },
        { headers: corsHeaders },
      )
    } finally {
      // Ensure client is closed even if there's an error
      if (client) {
        await client.end().catch(console.error)
      }
    }
  } catch (error) {
    console.error("Error processing Gumroad webhook:", error)
    return NextResponse.json(
      {
        error: "Failed to process webhook",
        message: error instanceof Error ? error.message : String(error),
        success: false,
      },
      { status: 500, headers: corsHeaders },
    )
  }
}

