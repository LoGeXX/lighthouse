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
    // Parse the request body
    let requestBody
    try {
      requestBody = await request.json()
    } catch (error) {
      console.error("Error parsing request body:", error)
      return NextResponse.json(
        { success: false, message: "Invalid request body" },
        { status: 400, headers: corsHeaders },
      )
    }

    const { licenseKey, product_id } = requestBody

    if (!licenseKey || !product_id) {
      return NextResponse.json(
        { success: false, valid: false, message: "License key and product ID are required" },
        { status: 400, headers: corsHeaders },
      )
    }

    // Validate the license key with Gumroad's API
    try {
      const response = await fetch("https://api.gumroad.com/v2/licenses/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          product_id: product_id,
          license_key: licenseKey,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error("Gumroad API error:", response.status, errorText)
        return NextResponse.json(
          {
            success: false,
            valid: false,
            message: `Gumroad API error: ${response.status}`,
            details: errorText,
          },
          { status: 502, headers: corsHeaders },
        )
      }

      const data = await response.json()

      // Return the validation result
      return NextResponse.json(
        {
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
        },
        { headers: corsHeaders },
      )
    } catch (fetchError) {
      console.error("Error fetching from Gumroad API:", fetchError)
      return NextResponse.json(
        {
          success: false,
          valid: false,
          message: "Failed to connect to Gumroad API",
          error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        },
        { status: 502, headers: corsHeaders },
      )
    }
  } catch (error) {
    console.error("Error validating Gumroad license:", error)
    return NextResponse.json(
      {
        success: false,
        valid: false,
        message: "Failed to validate license key",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500, headers: corsHeaders },
    )
  }
}

