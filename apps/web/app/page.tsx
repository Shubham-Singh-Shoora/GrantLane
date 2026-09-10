import { Landing } from "@/components/Landing";

/**
 * The landing page explains the product. It reads no chain state on purpose —
 * a first-time visitor needs to know what this is, not what the escrow balance
 * happens to be. Live figures live on /grants and the granter's audit view.
 */
export default function HomePage() {
  return <Landing />;
}
