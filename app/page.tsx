export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "6rem",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: "bold", marginBottom: "1.5rem" }}>Lighthouse Pro</h1>
      <p style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>License Management System</p>
      <div
        style={{
          backgroundColor: "#f0fff4",
          color: "#276749",
          padding: "1rem",
          borderRadius: "0.375rem",
        }}
      >
        API endpoints are active and ready to use
      </div>
    </main>
  )
}

