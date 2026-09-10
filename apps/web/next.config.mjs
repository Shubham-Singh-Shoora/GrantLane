/**
 * Environment comes from Next's own loading: `.env.local` in this directory for
 * local development, and the host's project settings in a deployment. There is
 * no custom loader — Next reads those before this file is evaluated, and inlines
 * `NEXT_PUBLIC_*` into the client bundle on its own.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
