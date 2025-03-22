export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        minHeight: "100vh",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "2rem", marginBottom: "1rem" }}>Lighthouse Pro - License Management</h1>
      <p style={{ marginBottom: "2rem" }}>API endpoints are active and ready to use</p>
      <div
        style={{
          backgroundColor: "#f0f0f0",
          padding: "1rem",
          borderRadius: "0.5rem",
          maxWidth: "600px",
          width: "100%",
          textAlign: "center",
        }}
      >
        <p>This is an API service. There is no UI to interact with directly.</p>
        <p>why are you here bro?</p>
      </div>
    </main>
  )
}

