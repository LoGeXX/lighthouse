export const runtime = "nodejs"

import { NextResponse } from "next/server"

// Add CORS headers to all responses
function addCorsHeaders(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*")
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  response.headers.set("Access-Control-Allow-Headers", "Content-Type")
  return response
}

export async function OPTIONS() {
  return addCorsHeaders(new NextResponse(null, { status: 204 }))
}

export async function POST(request: Request) {
  try {
    const { licenseKey, productPermalink } = await request.json()

    if (!licenseKey || !productPermalink) {
      return addCorsHeaders(
        NextResponse.json(
          { success: false, message: "License key and product permalink are required" },
          { status: 400 },
        ),
      )
    }

    // Validate the license key with Gumroad's API
    const response = await fetch("https://api.gumroad.com/v2/licenses/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        product_permalink: productPermalink,
        license_key: licenseKey,
      }),
    })

    const data = await response.json()

    // Return the validation result
    return addCorsHeaders(
      NextResponse.json({
        success: data.success,
        valid: data.success && data.purchase?.chargebacked === false,
        message: data.message || (data.success ? "License key is valid" : "Invalid license key"),
        purchase: data.success
          ? {
              email: data.purchase.email,
              full_name: data.purchase.full_name,
              created_at: data.purchase.created_at,
              refunded: data.purchase.refunded,
              chargebacked: data.purchase.chargebacked,
            }
          : null,
      }),
    )
  } catch (error) {
    console.error("Error validating Gumroad license:", error)
    return addCorsHeaders(
      NextResponse.json({ success: false, message: "Failed to validate license key" }, { status: 500 }),
    )
  }
}

