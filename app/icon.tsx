import { ImageResponse } from "next/og";

export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: 36,
          padding: 96,
          background: "linear-gradient(160deg, #2f7f8f 0%, #1f5a66 100%)",
          borderRadius: 112,
        }}
      >
        <div style={{ width: 64, height: 120, background: "#f7f4ee", borderRadius: 32 }} />
        <div style={{ width: 64, height: 220, background: "#f7f4ee", borderRadius: 32 }} />
        <div style={{ width: 64, height: 320, background: "#f7f4ee", borderRadius: 32 }} />
      </div>
    ),
    size,
  );
}
