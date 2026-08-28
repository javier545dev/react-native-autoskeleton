import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // This app is standalone (own package-lock.json, ADR-14: never a workspace
  // symlink), not a member of the repo-root workspace — pin the root explicitly
  // so Turbopack doesn't guess it from the sibling lockfiles under examples/*.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
