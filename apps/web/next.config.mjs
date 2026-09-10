// Pulls the repo-root .env into process.env before Next reads its config, so a
// single .env at the root serves the web app, the contracts and the workflow.
import { envPath } from "./load-env.mjs";

// On Vercel the variables come from the project settings, and there is no repo
// root .env to find — so a missing file is only worth warning about when the
// values are missing too.
if (envPath) {
  console.log(`[grantlane] loaded env from ${envPath}`);
} else if (!process.env.NEXT_PUBLIC_WORLD_APP_ID) {
  console.warn(
    "[grantlane] no .env found and NEXT_PUBLIC_WORLD_APP_ID is unset — " +
      "copy .env.example to .env locally, or set the variables in your host's project settings",
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    // NEXT_PUBLIC_* values are inlined at build time, so they must be visible to
    // the compiler here rather than only at runtime.
    NEXT_PUBLIC_WORLD_APP_ID: process.env.NEXT_PUBLIC_WORLD_APP_ID ?? "",
    NEXT_PUBLIC_WORLD_ACTION: process.env.NEXT_PUBLIC_WORLD_ACTION ?? "",
    NEXT_PUBLIC_ARC_CHAIN_ID: process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? "5042002",
    NEXT_PUBLIC_ARC_RPC_URL: process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.io",
    NEXT_PUBLIC_GRANT_ESCROW_ADDRESS: process.env.NEXT_PUBLIC_GRANT_ESCROW_ADDRESS ?? "",
    NEXT_PUBLIC_USDC_ADDRESS: process.env.NEXT_PUBLIC_USDC_ADDRESS ?? "",
  },
};

export default nextConfig;
