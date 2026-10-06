import { notFound } from "next/navigation";
import { PreviewGallery } from "@client/components/preview/preview-gallery";

/** D0: dev-only component preview at phone width (390 px). */
export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <PreviewGallery />;
}
