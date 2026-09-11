"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "@wagmi/core";
import { appChain, RPC_URL } from "@/lib/chain";
import { RoleProvider } from "@/components/RoleProvider";

const wagmiConfig = createConfig({
  chains: [appChain],
  connectors: [injected()],
  transports: { [appChain.id]: http(RPC_URL) },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RoleProvider>{children}</RoleProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
