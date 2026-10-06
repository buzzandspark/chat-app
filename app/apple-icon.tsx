import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 12,
          padding: 34,
          background: "linear-gradient(160deg, #2f7f8f 0%, #1f5a66 100%)",
        }}
      >
        <div style={{ width: 22, height: 42, background: "#f7f4ee", borderRadius: 11 }} />
        <div style={{ width: 22, height: 76, background: "#f7f4ee", borderRadius: 11 }} />
        <div style={{ width: 22, height: 112, background: "#f7f4ee", borderRadius: 11 }} />
      </div>
    ),
    size,
  );
}
