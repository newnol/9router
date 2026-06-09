import { NextResponse } from "next/server";
import { getProviderConnections, updateProviderConnection } from "@/lib/db/repos/connectionsRepo";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { provider } = body;

    const connections = provider
      ? await getProviderConnections({ provider })
      : await getProviderConnections();

    let resetCount = 0;
    for (const conn of connections) {
      const clearFields = {
        testStatus: null,
        lastError: null,
        lastErrorAt: null,
        errorCode: null,
        consecutiveFailCount: 0,
        circuitBreakerUntil: null,
        circuitHalfOpen: false,
      };
      for (const key of Object.keys(conn)) {
        if (key.startsWith("modelLock_") || key.startsWith("modelGroupLock_")) {
          clearFields[key] = null;
        }
      }
      await updateProviderConnection(conn.id, clearFields);
      resetCount++;
    }

    return NextResponse.json({ success: true, resetCount });
  } catch (error) {
    console.log("Error resetting error states:", error);
    return NextResponse.json({ error: "Failed to reset error states" }, { status: 500 });
  }
}
