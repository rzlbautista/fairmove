/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Runtime artifacts (job store, transcripts, recordings) live on the local
  // filesystem under ./data, so API routes must stay on the Node runtime.
  serverExternalPackages: [],
};

export default nextConfig;
